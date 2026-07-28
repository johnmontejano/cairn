import type { WorkspaceCrypto } from '@cairn/crypto';
import { type CairnTx, memoryRepo, sourcesRepo } from '@cairn/db';
import {
  type ActorContext,
  type RenderableItem,
  type Uuid,
  type VaultCommitChange,
  type VaultProvenance,
  type VaultVersion,
  CANONICAL_DOCS,
  canonicalPathForType,
  memoryTypes,
  parseCanonicalDocument,
  renderCanonicalDocument,
} from '@cairn/domain';

/**
 * Writing approved memory back out as canonical Markdown.
 *
 * Every approved change re-renders the affected documents from the database and
 * commits them as a new version. The Markdown is the canonical form — the
 * database rows are a convenience that can be rebuilt from it — so this function
 * running is what makes an approval real.
 */
/**
 * The part of the vault this module needs: a commit that joins the caller's
 * transaction. Structural, so ingestion depends on the capability rather than on
 * a particular vault implementation.
 */
export interface TransactionalVault {
  commitWithin(
    tx: CairnTx,
    crypto: WorkspaceCrypto,
    input: {
      actor: ActorContext;
      projectId: Uuid;
      changes: VaultCommitChange[];
      reason: string;
      authorLabel: string;
      provenance: VaultProvenance;
    },
  ): Promise<VaultVersion>;
}

export async function commitCanonicalMarkdown(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  vault: TransactionalVault,
  input: {
    actor: ActorContext;
    projectId: Uuid;
    reason: string;
    authorLabel: string;
    provenance: VaultProvenance;
  },
): Promise<{ version: VaultVersion | null; documents: string[] }> {
  const approved = await memoryRepo.listMemoryItems(tx, crypto, {
    workspaceId: input.actor.workspaceId,
    projectId: input.projectId,
    statuses: ['approved'],
    limit: 1000,
  });

  const evidenceByItem = await memoryRepo.listEvidence(
    tx,
    crypto,
    input.actor.workspaceId,
    approved.map((i) => i.id),
  );
  const sourceItems = await sourcesRepo.getSourceItems(tx, input.actor.workspaceId, [
    ...new Set([...evidenceByItem.values()].flat().map((e) => e.sourceItemId)),
  ]);
  const revisions = await sourcesRepo.getRevisions(tx, input.actor.workspaceId, [
    ...new Set([...evidenceByItem.values()].flat().map((e) => e.sourceRevisionId)),
  ]);

  const byType = new Map<string, RenderableItem[]>();
  for (const item of approved) {
    const list = byType.get(item.type) ?? [];
    list.push({
      id: item.id,
      type: item.type,
      title: item.title,
      value: item.value,
      topics: item.topics,
      sensitivity: item.sensitivity,
      observedAt: item.observedAt,
      updatedAt: item.updatedAt,
      evidence: (evidenceByItem.get(item.id) ?? []).map((e) => ({
        provider: sourceItems.get(e.sourceItemId)?.provider ?? 'paste',
        sourceTitle: sourceItems.get(e.sourceItemId)?.title ?? 'Unknown source',
        locator: e.locator,
        startOffset: e.startOffset,
        endOffset: e.endOffset,
        importedAt: revisions.get(e.sourceRevisionId)?.importedAt ?? e.createdAt,
      })),
    });
    byType.set(item.type, list);
  }

  // Every canonical document is rewritten each time, including the empty ones.
  // That costs nothing (content-addressed storage dedupes identical bytes) and it
  // means a document never silently lags behind the memory it should contain.
  const changes = memoryTypes.map((type) => ({
    path: CANONICAL_DOCS[type].path,
    content: renderCanonicalDocument(type, byType.get(type) ?? []),
  }));

  const version = await vault.commitWithin(tx, crypto, {
    actor: input.actor,
    projectId: input.projectId,
    changes,
    reason: input.reason,
    authorLabel: input.authorLabel,
    provenance: input.provenance,
  });

  const pathByItem = new Map(approved.map((item) => [item.id, canonicalPathForType(item.type)]));
  await memoryRepo.setCanonicalLocation(
    tx,
    input.actor.workspaceId,
    approved.map((i) => i.id),
    version.id,
    pathByItem,
  );

  return { version, documents: changes.map((c) => c.path) };
}

/**
 * Reads a canonical version back into structured items.
 *
 * This is the proof that the Markdown really is canonical: if the database were
 * lost, this is the path that rebuilds it.
 */
export function parseCanonicalVersion(
  files: Array<{ path: string; content: string }>,
): Array<ReturnType<typeof parseCanonicalDocument>[number]> {
  return files.flatMap((file) => parseCanonicalDocument(file.content));
}
