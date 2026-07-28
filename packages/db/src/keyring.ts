import { eq, sql } from 'drizzle-orm';
import { WorkspaceCrypto, getKeyProvider, type KeyProvider, type WrappedDek } from '@cairn/crypto';
import { NotFoundError } from '@cairn/domain';
import type { DbHandle, Queryable } from './client';
import * as schema from './schema';
import { withSystem } from './tenancy';

/**
 * Resolves a workspace's data key.
 *
 * The wrapped key is read from the database; unwrapping needs the deployment's
 * KEK, which the database never sees. Unwrapped keys are cached in process memory
 * for a short window because unwrapping is on the path of every read — the cache
 * is per-process, never serialized, and dropped on rotation.
 */
export class Keyring {
  private readonly cache = new Map<string, { crypto: WorkspaceCrypto; expiresAt: number }>();

  constructor(
    private readonly handle: DbHandle,
    private readonly provider: KeyProvider = getKeyProvider(),
    private readonly ttlMs = 5 * 60_000,
  ) {}

  async get(workspaceId: string): Promise<WorkspaceCrypto> {
    const hit = this.cache.get(workspaceId);
    if (hit && hit.expiresAt > Date.now()) return hit.crypto;

    const rows = await withSystem(this.handle, (tx) =>
      tx
        .select()
        .from(schema.workspaceKeys)
        .where(eq(schema.workspaceKeys.workspaceId, workspaceId))
        .limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('workspace key');

    const crypto = await WorkspaceCrypto.unwrap(this.provider, workspaceId, toWrapped(row));
    this.cache.set(workspaceId, { crypto, expiresAt: Date.now() + this.ttlMs });
    return crypto;
  }

  /** Creates the workspace's first data key. Idempotent. */
  async create(tx: Queryable, workspaceId: string): Promise<WorkspaceCrypto> {
    const { dek, wrapped } = await this.provider.createDek(workspaceId);
    await tx
      .insert(schema.workspaceKeys)
      .values({
        workspaceId,
        wrappedDek: wrapped.wrapped,
        keyProvider: wrapped.keyProvider,
        kekVersion: wrapped.kekVersion,
      })
      .onConflictDoNothing();
    const crypto = WorkspaceCrypto.fromDek(workspaceId, dek);
    this.cache.set(workspaceId, { crypto, expiresAt: Date.now() + this.ttlMs });
    return crypto;
  }

  /**
   * KEK rotation. Re-wraps the same data key under the current master key, so no
   * ciphertext in the database has to change.
   */
  async rotateKek(workspaceId: string): Promise<{ kekVersion: string }> {
    const wrapped = await withSystem(this.handle, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.workspaceKeys)
        .where(eq(schema.workspaceKeys.workspaceId, workspaceId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('workspace key');
      const next = await this.provider.rewrap(workspaceId, toWrapped(row));
      await tx
        .update(schema.workspaceKeys)
        .set({
          wrappedDek: next.wrapped,
          keyProvider: next.keyProvider,
          kekVersion: next.kekVersion,
          rotatedAt: sql`now()`,
        })
        .where(eq(schema.workspaceKeys.workspaceId, workspaceId));
      return next;
    });
    this.cache.delete(workspaceId);
    return { kekVersion: wrapped.kekVersion };
  }

  forget(workspaceId: string): void {
    this.cache.delete(workspaceId);
  }

  clear(): void {
    this.cache.clear();
  }
}

function toWrapped(row: typeof schema.workspaceKeys.$inferSelect): WrappedDek {
  return {
    wrapped: row.wrappedDek,
    keyProvider: row.keyProvider,
    kekVersion: row.kekVersion,
  };
}
