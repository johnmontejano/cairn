import { sql } from 'drizzle-orm';
import type { ActorContext } from '@cairn/domain';
import { ValidationError } from '@cairn/domain';
import type { CairnTx, DbHandle } from './client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label = 'id'): string {
  if (!UUID_RE.test(value)) throw new ValidationError(`${label} is not a valid identifier`);
  return value;
}

/**
 * Runs `fn` with row-level security enforced for one workspace.
 *
 * Two things happen inside the transaction: the workspace and user are published
 * as settings the RLS policies read, and the session drops to `cairn_app`, a role
 * that does not own the tables. Even a query that forgets its WHERE clause can
 * therefore only see one tenant's rows.
 *
 * `SET LOCAL` scopes both to this transaction, so a pooled connection cannot leak
 * one request's tenant into the next.
 */
export async function withTenant<T>(
  handle: DbHandle,
  actor: Pick<ActorContext, 'workspaceId' | 'userId'>,
  fn: (tx: CairnTx) => Promise<T>,
): Promise<T> {
  assertUuid(actor.workspaceId, 'workspaceId');
  if (actor.userId) assertUuid(actor.userId, 'userId');

  return handle.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('cairn.workspace_id', ${actor.workspaceId}, true)`);
    await tx.execute(sql`SELECT set_config('cairn.user_id', ${actor.userId ?? ''}, true)`);
    await tx.execute(sql.raw('SET LOCAL ROLE cairn_app'));
    return fn(tx as CairnTx);
  });
}

/**
 * Runs `fn` as the owning role, bypassing RLS.
 *
 * Reserved for the handful of operations that legitimately have no single tenant:
 * sign-in before a workspace is known, the worker's cross-tenant job claim loop,
 * migrations, and workspace deletion. Every call site is deliberate.
 */
export async function withSystem<T>(handle: DbHandle, fn: (tx: CairnTx) => Promise<T>): Promise<T> {
  return handle.db.transaction(async (tx) => fn(tx as CairnTx));
}
