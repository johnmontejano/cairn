import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { EnqueueInput, Job, JobState, JobType, QueueAdapter, Uuid } from '@cairn/domain';
import type { CairnTx, DbHandle } from '../client';
import * as schema from '../schema';
import { withSystem } from '../tenancy';
import { normalizeRows } from '../rows';

/**
 * Durable queue on Postgres.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so several workers can share a queue
 * without coordinating. The unique `(workspace_id, idempotency_key)` constraint
 * means enqueueing the same logical work twice is a no-op rather than duplicate
 * processing — which is what makes webhook redelivery and job retries safe.
 *
 * The same table works unchanged on Supabase Postgres; `SupabaseQueueAdapter`
 * exists for deployments that prefer pgmq.
 */
export class PostgresQueue implements QueueAdapter {
  readonly kind = 'postgres' as const;

  constructor(
    private readonly handle: DbHandle,
    private readonly workerId = `worker-${process.pid}`,
  ) {}

  async enqueue(input: EnqueueInput): Promise<{ job: Job; deduplicated: boolean }> {
    return withSystem(this.handle, (tx) => enqueueIn(tx, input));
  }

  async claim(limit: number, now = new Date()): Promise<Job[]> {
    // Cross-tenant by design: the worker serves every workspace. This is one of
    // the few deliberate uses of the system path.
    const result = await this.handle.db.execute(sql`
      WITH due AS (
        SELECT id FROM jobs
        WHERE state = 'queued' AND run_at <= ${now.toISOString()}
        ORDER BY run_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs SET
        state = 'running',
        attempts = jobs.attempts + 1,
        started_at = now(),
        locked_by = ${this.workerId}
      FROM due
      WHERE jobs.id = due.id
      RETURNING jobs.*
    `);
    return normalizeRows<JobRow>(result).map(fromSqlRow);
  }

  async complete(jobId: Uuid, durationMs: number): Promise<void> {
    await withSystem(this.handle, async (tx) => {
      await tx
        .update(schema.jobs)
        .set({ state: 'succeeded', finishedAt: sql`now()`, durationMs, lastError: null })
        .where(eq(schema.jobs.id, jobId));
    });
  }

  async fail(
    jobId: Uuid,
    error: { category: string; message: string },
    retryInMs: number | null,
  ): Promise<void> {
    await withSystem(this.handle, async (tx) => {
      const [job] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1);
      if (!job) return;
      const exhausted = retryInMs === null || job.attempts >= job.maxAttempts;
      await tx
        .update(schema.jobs)
        .set({
          state: exhausted ? 'dead' : 'queued',
          finishedAt: exhausted ? sql`now()` : null,
          runAt: exhausted
            ? job.runAt
            : sql`now() + (${Math.ceil(retryInMs / 1000)} || ' seconds')::interval`,
          errorCategory: error.category,
          // Truncated: an error message is diagnostic metadata, not a place for
          // source content to end up.
          lastError: error.message.slice(0, 500),
          lockedBy: null,
        })
        .where(eq(schema.jobs.id, jobId));
    });
  }
}

export async function enqueueIn(
  tx: CairnTx,
  input: EnqueueInput,
): Promise<{ job: Job; deduplicated: boolean }> {
  const [inserted] = await tx
    .insert(schema.jobs)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({
      target: [schema.jobs.workspaceId, schema.jobs.idempotencyKey],
    })
    .returning();

  if (inserted) return { job: toJob(inserted), deduplicated: false };

  const [existing] = await tx
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.workspaceId, input.workspaceId),
        eq(schema.jobs.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing) throw new Error('job enqueue raced with itself and lost');
  return { job: toJob(existing), deduplicated: true };
}

export async function listJobs(
  tx: CairnTx,
  workspaceId: Uuid,
  options?: { projectId?: Uuid; limit?: number },
): Promise<Job[]> {
  const conditions = [eq(schema.jobs.workspaceId, workspaceId)];
  if (options?.projectId) conditions.push(eq(schema.jobs.projectId, options.projectId));
  const rows = await tx
    .select()
    .from(schema.jobs)
    .where(and(...conditions))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(options?.limit ?? 50);
  return rows.map(toJob);
}

export async function retryJob(tx: CairnTx, workspaceId: Uuid, jobId: Uuid): Promise<void> {
  await tx
    .update(schema.jobs)
    .set({ state: 'queued', runAt: sql`now()`, attempts: 0, lastError: null, errorCategory: null })
    .where(and(eq(schema.jobs.workspaceId, workspaceId), eq(schema.jobs.id, jobId)));
}

type JobRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  type: string;
  state: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  run_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  duration_ms: number | null;
  error_category: string | null;
  last_error: string | null;
  created_at: string | Date;
};

function fromSqlRow(row: JobRow): Job {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    type: row.type as JobType,
    state: row.state as JobState,
    idempotencyKey: row.idempotency_key,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: new Date(row.run_at),
    startedAt: row.started_at ? new Date(row.started_at) : null,
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
    durationMs: row.duration_ms,
    errorCategory: row.error_category,
    lastError: row.last_error,
    createdAt: new Date(row.created_at),
  };
}

export function toJob(row: typeof schema.jobs.$inferSelect): Job {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    type: row.type as JobType,
    state: row.state as JobState,
    idempotencyKey: row.idempotencyKey,
    payload: row.payload as Record<string, unknown>,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAt: row.runAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    errorCategory: row.errorCategory,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}
