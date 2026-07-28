import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { contentHash } from '@cairn/crypto';
import {
  auditRepo,
  memoryRepo,
  schema,
  sourcesRepo,
  usageRepo,
  withSystem,
  withTenant,
  jobsRepo,
} from '@cairn/db';
import {
  type ActorContext,
  type Job,
  type SourceProvider,
  type Uuid,
  DomainError,
  ValidationError,
  assertApprovable,
} from '@cairn/domain';
import { indexMemoryItems, rebuildProjectIndex } from '@cairn/search';
import { createConnector } from '@cairn/connectors';
import { chunkText } from './chunk';
import { commitCanonicalMarkdown } from './canonical';
import { normalizeSource } from './normalize';
import { reconcileCandidates } from './reconcile';
import type { CairnServices } from './services';

/**
 * The ingestion pipeline.
 *
 * Split into small jobs that each do one thing and can each be retried alone.
 * Every step is keyed by content: re-submitting the same bytes, replaying a
 * webhook, or retrying a half-finished job converges on the same state instead of
 * duplicating work. That property is what makes the queue safe under the
 * at-least-once delivery every real provider gives you.
 */

/** A worker acts for the workspace, not for a person. */
export function systemActor(workspaceId: Uuid): ActorContext {
  return { workspaceId, userId: null, role: 'owner' };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export interface SubmitSourceInput {
  actor: ActorContext;
  projectId: Uuid;
  provider: SourceProvider;
  externalId: string;
  title: string;
  mimeType: string;
  canonicalUri?: string | null;
  externalRevision?: string | null;
  connectionId?: Uuid | null;
  bytes: Uint8Array;
}

export interface SubmitSourceResult {
  sourceItemId: Uuid;
  revisionId: Uuid;
  /** True when these exact bytes were already stored: nothing new to process. */
  deduplicated: boolean;
  jobId: Uuid | null;
  warnings: string[];
}

export async function submitSource(
  services: CairnServices,
  input: SubmitSourceInput,
): Promise<SubmitSourceResult> {
  const maxBytes = services.config.env.CAIRN_MAX_UPLOAD_BYTES;
  if (input.bytes.byteLength > maxBytes) {
    throw new ValidationError(
      `Upload of ${input.bytes.byteLength} bytes exceeds limit`,
      `That file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
    );
  }

  const normalized = await normalizeSource({
    bytes: input.bytes,
    mimeType: input.mimeType,
    filename: input.title,
  });
  const crypto = await services.keyring.get(input.actor.workspaceId);
  const hash = contentHash(input.bytes);
  const storageKey = `raw/${hash.replace('sha256:', '')}`;

  // The immutable raw snapshot, encrypted before it leaves this process so the
  // object store — local table or Supabase bucket — only ever holds ciphertext.
  // Written before the transaction opens: it is content-addressed, so writing it
  // twice is a no-op, and an unreferenced blob is harmless where a missing one
  // would not be. Opening a second transaction inside the first would also
  // deadlock a single-connection database.
  await services
    .objectStore(input.actor.workspaceId)
    .put(storageKey, crypto.encryptBlob(input.bytes, 'source_raw', hash));

  return withTenant(services.handle, input.actor, async (tx) => {
    const item = await sourcesRepo.upsertSourceItem(tx, {
      workspaceId: input.actor.workspaceId,
      projectId: input.projectId,
      connectionId: input.connectionId ?? null,
      provider: input.provider,
      externalId: input.externalId,
      title: input.title,
      mimeType: normalized.mimeType,
      canonicalUri: input.canonicalUri ?? null,
    });

    const { revision, created } = await sourcesRepo.upsertSourceRevision(tx, crypto, {
      workspaceId: input.actor.workspaceId,
      sourceItemId: item.id,
      externalRevision: input.externalRevision ?? null,
      rawBytes: input.bytes,
      normalizedText: normalized.text,
      storageKey,
    });

    if (!created) {
      return {
        sourceItemId: item.id,
        revisionId: revision.id,
        deduplicated: true,
        jobId: null,
        warnings: normalized.warnings,
      };
    }

    const { job } = await jobsRepo.enqueueIn(tx, {
      workspaceId: input.actor.workspaceId,
      projectId: input.projectId,
      type: 'source.ingest',
      idempotencyKey: `ingest:${revision.id}`,
      payload: { sourceItemId: item.id, revisionId: revision.id, projectId: input.projectId },
    });

    await auditRepo.recordAudit(tx, {
      workspaceId: input.actor.workspaceId,
      actorUserId: input.actor.userId,
      action: 'source.ingested',
      subjectType: 'source_item',
      subjectId: item.id,
      metadata: {
        provider: input.provider,
        bytes: input.bytes.byteLength,
        mimeType: normalized.mimeType,
      },
    });

    return {
      sourceItemId: item.id,
      revisionId: revision.id,
      deduplicated: false,
      jobId: job.id,
      warnings: normalized.warnings,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Job handlers
 * ------------------------------------------------------------------ */

export type JobResult = Record<string, unknown>;

async function handleIngest(services: CairnServices, job: Job): Promise<JobResult> {
  const { revisionId, projectId } = job.payload as { revisionId: Uuid; projectId: Uuid };
  const actor = systemActor(job.workspaceId);
  const crypto = await services.keyring.get(job.workspaceId);

  const chunkCount = await withTenant(services.handle, actor, async (tx) => {
    const text = await sourcesRepo.readNormalizedText(tx, crypto, job.workspaceId, revisionId);
    if (text === null) throw new ValidationError('Source revision has no normalized text');

    const chunks = chunkText(text);
    for (const chunk of chunks) {
      await tx
        .insert(schema.chunks)
        .values({
          id: randomUUID(),
          workspaceId: job.workspaceId,
          projectId,
          sourceRevisionId: revisionId,
          ordinal: chunk.ordinal,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          charCount: chunk.text.length,
          encryptedText: crypto.encryptContent(
            chunk.text,
            'chunk_text',
            `${revisionId}:${chunk.ordinal}`,
          ),
          contentHash: contentHash(chunk.text),
        })
        // Re-running this job must not duplicate chunks.
        .onConflictDoNothing();
    }
    return chunks.length;
  });

  await withTenant(services.handle, actor, async (tx) => {
    await jobsRepo.enqueueIn(tx, {
      workspaceId: job.workspaceId,
      projectId,
      type: 'source.extract',
      idempotencyKey: `extract:${revisionId}`,
      payload: job.payload,
    });
  });

  return { chunks: chunkCount };
}

async function handleExtract(services: CairnServices, job: Job): Promise<JobResult> {
  const { revisionId, sourceItemId, projectId } = job.payload as {
    revisionId: Uuid;
    sourceItemId: Uuid;
    projectId: Uuid;
  };
  const actor = systemActor(job.workspaceId);
  const crypto = await services.keyring.get(job.workspaceId);

  const prepared = await withTenant(services.handle, actor, async (tx) => {
    // Refuse to spend before spending, not after.
    await usageRepo.assertWithinBudget(tx, job.workspaceId, {
      defaultBudgetUsd: services.config.env.CAIRN_AI_MONTHLY_BUDGET_USD,
      softRatio: services.config.env.CAIRN_AI_SOFT_LIMIT_RATIO,
    });
    const text = await sourcesRepo.readNormalizedText(tx, crypto, job.workspaceId, revisionId);
    const items = await sourcesRepo.getSourceItems(tx, job.workspaceId, [sourceItemId]);
    const project = await tx
      .select({ name: schema.projects.name })
      .from(schema.projects)
      .where(
        and(eq(schema.projects.workspaceId, job.workspaceId), eq(schema.projects.id, projectId)),
      )
      .limit(1);
    return { text, item: items.get(sourceItemId), projectName: project[0]?.name ?? 'this project' };
  });

  if (!prepared.text || !prepared.item) throw new ValidationError('Source is no longer available');

  const { candidates, usage } = await services.extractor.extract({
    text: prepared.text,
    sourceTitle: prepared.item.title,
    provider: prepared.item.provider,
    projectName: prepared.projectName,
    contentHash: contentHash(prepared.text),
  });

  const result = await withTenant(services.handle, actor, async (tx) => {
    const reconciled = await reconcileCandidates(tx, crypto, {
      workspaceId: job.workspaceId,
      projectId,
      sourceItemId,
      sourceRevisionId: revisionId,
      normalizedText: prepared.text!,
      candidates,
      extraction: {
        model: usage.model,
        promptVersion: usage.promptVersion,
        schemaVersion: usage.schemaVersion,
      },
    });
    await usageRepo.recordModelUsage(tx, {
      workspaceId: job.workspaceId,
      projectId,
      jobId: job.id,
      operation: 'extraction',
      provider: services.extractor.kind,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      cached: usage.cached,
    });
    await auditRepo.recordAudit(tx, {
      workspaceId: job.workspaceId,
      action: 'memory.proposed',
      subjectType: 'source_item',
      subjectId: sourceItemId,
      metadata: {
        proposed: reconciled.proposed,
        duplicates: reconciled.duplicates,
        conflicts: reconciled.conflicts,
        model: usage.model,
      },
    });
    return reconciled;
  });

  return { ...result, model: usage.model, estimatedCostUsd: usage.estimatedCostUsd };
}

async function handleVaultCommit(services: CairnServices, job: Job): Promise<JobResult> {
  const { projectId, reason, authorLabel } = job.payload as {
    projectId: Uuid;
    reason: string;
    authorLabel?: string;
  };
  const actor = systemActor(job.workspaceId);
  const crypto = await services.keyring.get(job.workspaceId);

  const { version } = await withTenant(services.handle, actor, (tx) =>
    commitCanonicalMarkdown(tx, crypto, services.vault, {
      actor,
      projectId,
      reason,
      authorLabel: authorLabel ?? 'Cairn',
      provenance: { kind: 'ingestion' },
    }),
  );
  return { versionId: version?.id ?? null };
}

async function handleIndexRebuild(services: CairnServices, job: Job): Promise<JobResult> {
  const { projectId } = job.payload as { projectId: Uuid };
  const actor = systemActor(job.workspaceId);
  const crypto = await services.keyring.get(job.workspaceId);

  const result = await withTenant(services.handle, actor, (tx) =>
    rebuildProjectIndex(tx, crypto, services.embedder, job.workspaceId, projectId),
  );
  return result;
}

async function handleConnectionSync(services: CairnServices, job: Job): Promise<JobResult> {
  const { connectionId } = job.payload as { connectionId: Uuid };
  const actor = systemActor(job.workspaceId);
  const crypto = await services.keyring.get(job.workspaceId);

  const context = await withTenant(services.handle, actor, async (tx) => {
    const connection = await sourcesRepo.getConnection(tx, job.workspaceId, connectionId);
    if (!connection) throw new ValidationError('Connection no longer exists');
    if (connection.state === 'disconnected') {
      throw new ValidationError('Connection was disconnected');
    }
    const credential = await sourcesRepo.readConnectionCredential(
      tx,
      crypto,
      job.workspaceId,
      connectionId,
    );
    const [run] = await tx
      .insert(schema.syncRuns)
      .values({ id: randomUUID(), workspaceId: job.workspaceId, connectionId })
      .returning();
    return { connection, credential, runId: run!.id };
  });

  const connector = createConnector(context.connection.provider, services.config);
  if (!connector) throw new ValidationError(`No connector for ${context.connection.provider}`);

  let seen = 0;
  let imported = 0;
  let skipped = 0;
  try {
    const { items, nextCursor } = await connector.list({
      connectionId,
      cursor: context.connection.cursor,
      credential: context.credential,
    });
    for (const fetched of items) {
      seen += 1;
      const result = await submitSource(services, {
        actor,
        projectId: context.connection.projectId,
        provider: context.connection.provider,
        externalId: fetched.externalId,
        title: fetched.title,
        mimeType: fetched.mimeType,
        canonicalUri: fetched.canonicalUri,
        externalRevision: fetched.externalRevision,
        connectionId,
        bytes: fetched.bytes,
      });
      if (result.deduplicated) skipped += 1;
      else imported += 1;
    }
    await withTenant(services.handle, actor, async (tx) => {
      await sourcesRepo.updateConnectionState(tx, job.workspaceId, connectionId, {
        state: 'active',
        cursor: nextCursor,
        lastError: null,
        synced: true,
      });
      await tx
        .update(schema.syncRuns)
        .set({
          state: 'succeeded',
          itemsSeen: seen,
          itemsImported: imported,
          itemsSkipped: skipped,
          finishedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, context.runId));
    });
  } catch (error) {
    const message =
      error instanceof DomainError ? error.userMessage : 'The connection could not be read.';
    await withTenant(services.handle, actor, async (tx) => {
      await sourcesRepo.updateConnectionState(tx, job.workspaceId, connectionId, {
        state: 'needs_reconnect',
        lastError: message,
      });
      await tx
        .update(schema.syncRuns)
        .set({ state: 'failed', message, finishedAt: new Date(), itemsSeen: seen })
        .where(eq(schema.syncRuns.id, context.runId));
    });
    throw error;
  }

  return { seen, imported, skipped };
}

const HANDLERS: Partial<Record<Job['type'], (s: CairnServices, j: Job) => Promise<JobResult>>> = {
  'source.ingest': handleIngest,
  'source.extract': handleExtract,
  'vault.commit': handleVaultCommit,
  'index.rebuild': handleIndexRebuild,
  'connection.sync': handleConnectionSync,
};

/** Errors worth retrying, versus ones that will fail identically forever. */
export function categorizeError(error: unknown): { category: string; retryable: boolean } {
  if (error instanceof DomainError) {
    const permanent = ['validation_failed', 'not_found', 'forbidden', 'evidence_required'];
    return { category: error.code, retryable: !permanent.includes(error.code) };
  }
  const message = String((error as Error)?.message ?? error);
  if (/ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|429|503/i.test(message)) {
    return { category: 'transient', retryable: true };
  }
  return { category: 'unknown', retryable: true };
}

export async function runJob(services: CairnServices, job: Job): Promise<JobResult> {
  const handler = HANDLERS[job.type];
  if (!handler) throw new ValidationError(`No handler for job type ${job.type}`);
  return handler(services, job);
}

/**
 * Claims and runs due jobs. Returns how many ran, so a caller can loop until
 * quiet — which is exactly what the tests and the demo seeder do.
 */
export async function processDueJobs(
  services: CairnServices,
  limit = 5,
): Promise<{ processed: number; failed: number }> {
  const jobs = await services.queue.claim(limit);
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const startedAt = Date.now();
    const log = services.logger.child({
      jobId: job.id,
      jobType: job.type,
      workspaceId: job.workspaceId,
    });
    try {
      const result = await runJob(services, job);
      await services.queue.complete(job.id, Date.now() - startedAt);
      log.info('job.succeeded', { durationMs: Date.now() - startedAt, ...result });
      processed += 1;
    } catch (error) {
      const { category, retryable } = categorizeError(error);
      const backoffMs = retryable ? Math.min(2 ** job.attempts * 1000, 60_000) : null;
      await services.queue.fail(
        job.id,
        { category, message: (error as Error).message ?? 'unknown' },
        backoffMs,
      );
      services.errors.captureException(error, { jobType: job.type, category });
      log.error('job.failed', { category, retryable, attempts: job.attempts, error });
      failed += 1;
    }
  }
  return { processed, failed };
}

/** Runs until nothing is left to do. Used by tests, the seeder, and demo mode. */
export async function drainJobs(
  services: CairnServices,
  options?: { maxRounds?: number; batch?: number },
): Promise<{ processed: number; failed: number; rounds: number }> {
  let processed = 0;
  let failed = 0;
  let rounds = 0;
  const maxRounds = options?.maxRounds ?? 50;

  while (rounds < maxRounds) {
    rounds += 1;
    const result = await processDueJobs(services, options?.batch ?? 10);
    processed += result.processed;
    failed += result.failed;
    if (result.processed === 0 && result.failed === 0) break;
  }
  return { processed, failed, rounds };
}

/* ------------------------------------------------------------------ *
 * Approval
 * ------------------------------------------------------------------ */

/**
 * Approving a proposed memory.
 *
 * The evidence check is not advisory: a memory with nothing to point back to
 * cannot become approved, so "where did you learn that?" always has an answer.
 * Approval then commits canonical Markdown and refreshes the index, so the
 * website, an export, and an AI client all see the same thing.
 */
export async function approveMemoryItem(
  services: CairnServices,
  actor: ActorContext,
  input: { memoryItemId: Uuid; projectId: Uuid; authorLabel: string },
): Promise<{ versionId: Uuid | null }> {
  const crypto = await services.keyring.get(actor.workspaceId);

  return withTenant(services.handle, actor, async (tx) => {
    const evidenceCount = await memoryRepo.countEvidence(tx, actor.workspaceId, input.memoryItemId);
    assertApprovable(evidenceCount);

    await memoryRepo.setMemoryStatus(tx, actor.workspaceId, input.memoryItemId, 'approved');
    await tx
      .update(schema.memoryProposals)
      .set({ state: 'accepted', decidedAt: new Date(), decidedBy: actor.userId })
      .where(
        and(
          eq(schema.memoryProposals.workspaceId, actor.workspaceId),
          eq(schema.memoryProposals.memoryItemId, input.memoryItemId),
        ),
      );

    const item = await memoryRepo.getMemoryItem(tx, crypto, actor.workspaceId, input.memoryItemId);
    if (item) await indexMemoryItems(tx, crypto, services.embedder, [item]);

    const { version } = await commitCanonicalMarkdown(tx, crypto, services.vault, {
      actor,
      projectId: input.projectId,
      reason: 'Approved a memory',
      authorLabel: input.authorLabel,
      provenance: { kind: 'user_approval', memoryItemIds: [input.memoryItemId] },
    });

    await auditRepo.recordAudit(tx, {
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: 'memory.approved',
      subjectType: 'memory_item',
      subjectId: input.memoryItemId,
      metadata: { versionId: version?.id ?? null },
    });
    return { versionId: version?.id ?? null };
  });
}

export async function rejectMemoryItem(
  services: CairnServices,
  actor: ActorContext,
  memoryItemId: Uuid,
): Promise<void> {
  await withTenant(services.handle, actor, async (tx) => {
    await memoryRepo.softDeleteMemoryItem(tx, actor.workspaceId, memoryItemId);
    await tx
      .update(schema.memoryProposals)
      .set({ state: 'rejected', decidedAt: new Date(), decidedBy: actor.userId })
      .where(
        and(
          eq(schema.memoryProposals.workspaceId, actor.workspaceId),
          eq(schema.memoryProposals.memoryItemId, memoryItemId),
        ),
      );
    await auditRepo.recordAudit(tx, {
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: 'memory.rejected',
      subjectType: 'memory_item',
      subjectId: memoryItemId,
    });
  });
}

export { withSystem };
