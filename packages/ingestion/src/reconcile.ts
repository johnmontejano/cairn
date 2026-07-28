import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceCrypto } from '@cairn/crypto';
import { type CairnTx, memoryRepo, schema } from '@cairn/db';
import {
  type MemoryCandidate,
  type MemoryItem,
  type MemoryType,
  type Uuid,
  decidePrecedence,
  isSingletonType,
  normalizedTokens,
} from '@cairn/domain';

/**
 * Turning candidates into reviewable proposals.
 *
 * Two rules do the real work here. Nothing is ever silently overwritten: a
 * disagreement produces a conflict a person resolves, and the losing assertion
 * stays in history. And an exact duplicate is dropped rather than piled up, so
 * re-importing the same document does not double the review queue.
 */

const NUMERIC_OR_DATE =
  /^(\d+|january|february|march|april|may|june|july|august|september|october|november|december|mon|tue|wed|thu|fri|sat|sun)$/i;

/**
 * The "what is this claim about" fingerprint, with the values stripped out.
 *
 * "the opening date is 4 September" and "the opening date is 18 September" share
 * a claim key precisely because the numbers and month names are removed — which
 * is what lets contradiction detection notice they are talking about the same
 * thing.
 */
export function claimKey(value: string): Set<string> {
  return new Set(normalizedTokens(value).filter((t) => !NUMERIC_OR_DATE.test(t)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export const CONTRADICTION_THRESHOLD = 0.6;

export interface Contradiction {
  existing: MemoryItem;
  similarity: number;
  reason: string;
}

export function findContradiction(
  incoming: { type: MemoryType; value: string },
  existing: MemoryItem[],
): Contradiction | null {
  const incomingKey = claimKey(incoming.value);
  let best: Contradiction | null = null;

  for (const item of existing) {
    if (item.type !== incoming.type) continue;
    if (item.status !== 'approved') continue;
    if (item.normalizedValue === incoming.value.toLowerCase().trim()) continue;

    if (isSingletonType(item.type)) {
      // Only one project brief or current state can be true at a time, so any
      // second approved one is a contradiction by construction.
      return {
        existing: item,
        similarity: 1,
        reason: `There is already a saved ${item.type.replace('_', ' ')} and they do not agree.`,
      };
    }
    const similarity = jaccard(incomingKey, claimKey(item.value));
    if (similarity >= CONTRADICTION_THRESHOLD && (!best || similarity > best.similarity)) {
      best = {
        existing: item,
        similarity,
        reason: 'Two notes say different things about the same subject.',
      };
    }
  }
  return best;
}

/**
 * What should happen when a person writes something that contradicts what is
 * already saved.
 *
 * Explicit human intent outranks passive extraction, so a typed correction
 * supersedes an extracted claim outright. Two assertions of equal authority still
 * go to a conflict — the product does not get to decide which of the user's own
 * statements is right.
 */
export function decideAgainstExisting(
  incoming: Pick<
    MemoryItem,
    'extractionMethod' | 'normalizedValue' | 'observedAt' | 'type' | 'value'
  >,
  existing: MemoryItem[],
): {
  outcome: 'supersede' | 'conflict' | 'duplicate' | 'none';
  reason: string;
  against: MemoryItem | null;
} {
  const contradiction = findContradiction(incoming, existing);
  if (!contradiction) return { outcome: 'none', reason: 'No disagreement found', against: null };
  const decision = decidePrecedence(incoming, contradiction.existing);
  return { outcome: decision.outcome, reason: decision.reason, against: contradiction.existing };
}

export interface ReconcileResult {
  proposed: number;
  duplicates: number;
  conflicts: number;
  proposalIds: Uuid[];
}

export async function reconcileCandidates(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  input: {
    workspaceId: Uuid;
    projectId: Uuid;
    sourceItemId: Uuid;
    sourceRevisionId: Uuid;
    normalizedText: string;
    candidates: MemoryCandidate[];
    extraction: { model: string; promptVersion: string; schemaVersion: string };
  },
): Promise<ReconcileResult> {
  const existing = await memoryRepo.listMemoryItems(tx, crypto, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    statuses: ['approved', 'proposed', 'conflicted'],
    limit: 1000,
  });

  const result: ReconcileResult = { proposed: 0, duplicates: 0, conflicts: 0, proposalIds: [] };

  for (const candidate of input.candidates) {
    if (candidate.evidence.length === 0) continue; // structurally unusable

    const duplicates = await memoryRepo.findByNormalizedValue(
      tx,
      crypto,
      input.workspaceId,
      input.projectId,
      candidate.value,
    );
    if (duplicates.length > 0) {
      result.duplicates += 1;
      continue;
    }

    const contradiction = findContradiction(candidate, existing);
    const conflictGroupId = contradiction
      ? (contradiction.existing.conflictGroupId ?? randomUUID())
      : null;

    const item = await memoryRepo.insertMemoryItem(tx, crypto, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      type: candidate.type,
      status: 'proposed',
      title: candidate.title,
      value: candidate.value,
      topics: candidate.topics,
      sensitivity: candidate.sensitivity,
      // Anything flagged sensitive stays off the AI-client path until a person
      // decides otherwise.
      visibility:
        candidate.sensitivity === 'normal' ? 'share_with_authorized_clients' : 'website_only',
      observedAt: candidate.observedAt,
      extractionMethod: 'ai_extraction',
      extractionModel: input.extraction.model,
      extractionPromptVersion: input.extraction.promptVersion,
      extractionSchemaVersion: input.extraction.schemaVersion,
      confidence: candidate.confidence,
      conflictGroupId,
    });

    for (const evidence of candidate.evidence) {
      await memoryRepo.addEvidence(tx, crypto, {
        workspaceId: input.workspaceId,
        memoryItemId: item.id,
        sourceItemId: input.sourceItemId,
        sourceRevisionId: input.sourceRevisionId,
        startOffset: evidence.startOffset,
        endOffset: evidence.endOffset,
        excerpt: evidence.excerpt,
        locator: evidence.locator ?? null,
      });
    }

    const [proposal] = await tx
      .insert(schema.memoryProposals)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        memoryItemId: item.id,
        origin: 'ingestion',
        note: contradiction ? contradiction.reason : null,
      })
      .returning();
    if (proposal) result.proposalIds.push(proposal.id);

    if (contradiction && conflictGroupId) {
      await tx.insert(schema.memoryConflicts).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        memoryItemIds: [contradiction.existing.id, item.id],
        reason: contradiction.reason,
      });
      await memoryRepo.setMemoryStatus(
        tx,
        input.workspaceId,
        contradiction.existing.id,
        'conflicted',
        {
          conflictGroupId,
        },
      );
      result.conflicts += 1;
    }

    existing.push(item);
    result.proposed += 1;
  }

  return result;
}

/**
 * Resolving a conflict.
 *
 * The winner becomes approved; the loser becomes superseded, not deleted, and the
 * two stay linked. Nothing that was ever asserted disappears from history.
 */
export async function resolveConflict(
  tx: CairnTx,
  input: {
    workspaceId: Uuid;
    conflictId: Uuid;
    keepMemoryItemId: Uuid;
    resolvedBy: Uuid | null;
  },
): Promise<{ superseded: Uuid[] }> {
  const [conflict] = await tx
    .select()
    .from(schema.memoryConflicts)
    .where(
      and(
        eq(schema.memoryConflicts.workspaceId, input.workspaceId),
        eq(schema.memoryConflicts.id, input.conflictId),
      ),
    )
    .limit(1);
  if (!conflict) return { superseded: [] };

  const losers = conflict.memoryItemIds.filter((id) => id !== input.keepMemoryItemId);
  await memoryRepo.setMemoryStatus(tx, input.workspaceId, input.keepMemoryItemId, 'approved', {
    conflictGroupId: null,
  });
  for (const loser of losers) {
    await memoryRepo.setMemoryStatus(tx, input.workspaceId, loser, 'superseded', {
      supersededById: input.keepMemoryItemId,
    });
  }
  await tx
    .update(schema.memoryConflicts)
    .set({
      status: 'resolved',
      resolvedMemoryItemId: input.keepMemoryItemId,
      resolvedBy: input.resolvedBy,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(schema.memoryConflicts.workspaceId, input.workspaceId),
        eq(schema.memoryConflicts.id, input.conflictId),
      ),
    );

  return { superseded: losers };
}
