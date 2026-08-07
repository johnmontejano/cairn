import { and, inArray, isNull } from 'drizzle-orm';
import { jobsRepo, schema, withSystem } from '@cairn/db';
import type { CairnServices } from './services';

/**
 * The scheduled refresh, as logic rather than as an HTTP route.
 *
 * Every connector in this product read "nothing runs on its own", which was
 * true and was the single reason someone had to keep clicking to keep their
 * memory current. This is the thing that runs on its own.
 *
 * It lives here rather than in the route handler so it can be tested against a
 * real database without standing up a web server, and so the route is reduced
 * to the one thing a route should own: deciding whether the caller is allowed.
 *
 * It deliberately enqueues the same `connection.sync` job a person's "Check for
 * updates" button enqueues, so the scheduled path and the manual path cannot
 * drift apart.
 */

/** Connection states that can read something real. `demo` fixtures cannot. */
export const SYNCABLE_STATES = ['active', 'ready'] as const;

export interface ScheduledSyncResult {
  /** Live connections found across every workspace. */
  connections: number;
  /** Jobs newly enqueued by this run. */
  enqueued: number;
  /** Connections whose job for this bucket already existed. */
  alreadyQueued: number;
  /** Connections whose enqueue threw; the rest still ran. */
  failed: number;
}

/**
 * Enqueues one sync per live connection, across every workspace.
 *
 * Cross-tenant by nature: a scheduler has no session and no single workspace.
 * That is the same justification the worker's claim loop uses for `withSystem`.
 *
 * `bucketMs` controls collapsing. At the default hour, a scheduler that fires
 * twice in one hour — a retry, an overlapping manual trigger — produces one
 * sync rather than two. The button a person presses uses a minute bucket and so
 * is never blocked by a scheduled run.
 */
export async function enqueueScheduledSyncs(
  services: CairnServices,
  options: { now?: number; bucketMs?: number } = {},
): Promise<ScheduledSyncResult> {
  const now = options.now ?? Date.now();
  const bucketMs = options.bucketMs ?? 3_600_000;
  const bucket = Math.floor(now / bucketMs);
  const log = services.logger.child({ component: 'scheduled.sync' });

  const connections = await withSystem(services.handle, (tx) =>
    tx
      .select({
        id: schema.sourceConnections.id,
        workspaceId: schema.sourceConnections.workspaceId,
        projectId: schema.sourceConnections.projectId,
        provider: schema.sourceConnections.provider,
      })
      .from(schema.sourceConnections)
      .where(
        and(
          inArray(schema.sourceConnections.state, [...SYNCABLE_STATES]),
          isNull(schema.sourceConnections.disconnectedAt),
        ),
      ),
  );

  let enqueued = 0;
  let alreadyQueued = 0;
  let failed = 0;

  for (const connection of connections) {
    try {
      const { deduplicated } = await withSystem(services.handle, (tx) =>
        jobsRepo.enqueueIn(tx, {
          workspaceId: connection.workspaceId,
          projectId: connection.projectId,
          type: 'connection.sync',
          idempotencyKey: `cron-sync:${connection.id}:${bucket}`,
          payload: { connectionId: connection.id },
        }),
      );
      if (deduplicated) alreadyQueued += 1;
      else enqueued += 1;
    } catch (error) {
      // One unhealthy connection must not stop the rest of the workspace, let
      // alone every other tenant's refresh.
      failed += 1;
      log.error('scheduled.sync.enqueue_failed', {
        connectionId: connection.id,
        provider: connection.provider,
        error,
      });
      services.errors.captureException(error, { component: 'scheduled.sync' });
    }
  }

  return { connections: connections.length, enqueued, alreadyQueued, failed };
}
