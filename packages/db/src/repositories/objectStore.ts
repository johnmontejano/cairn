import { and, eq, like, sql } from 'drizzle-orm';
import type { ObjectStore } from '@cairn/domain';
import type { DbHandle } from '../client';
import * as schema from '../schema';
import { withSystem } from '../tenancy';

/**
 * Encrypted blob storage in Postgres.
 *
 * Used when no external object store is configured. Bytes arrive already
 * encrypted by the caller — this layer never sees plaintext and never holds a key,
 * which is what lets the Supabase adapter be a drop-in replacement.
 */
export class DatabaseObjectStore implements ObjectStore {
  readonly kind = 'database' as const;

  constructor(
    private readonly handle: DbHandle,
    private readonly workspaceId: string,
  ) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await withSystem(this.handle, async (tx) => {
      await tx
        .insert(schema.storedObjects)
        .values({
          workspaceId: this.workspaceId,
          key,
          bytes,
          byteSize: bytes.byteLength,
        })
        .onConflictDoUpdate({
          target: [schema.storedObjects.workspaceId, schema.storedObjects.key],
          set: { bytes, byteSize: bytes.byteLength },
        });
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    return withSystem(this.handle, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.storedObjects)
        .where(
          and(
            eq(schema.storedObjects.workspaceId, this.workspaceId),
            eq(schema.storedObjects.key, key),
          ),
        )
        .limit(1);
      return row?.bytes ?? null;
    });
  }

  async delete(key: string): Promise<void> {
    await withSystem(this.handle, async (tx) => {
      await tx
        .delete(schema.storedObjects)
        .where(
          and(
            eq(schema.storedObjects.workspaceId, this.workspaceId),
            eq(schema.storedObjects.key, key),
          ),
        );
    });
  }

  async deletePrefix(prefix: string): Promise<number> {
    return withSystem(this.handle, async (tx) => {
      const result = await tx
        .delete(schema.storedObjects)
        .where(
          and(
            eq(schema.storedObjects.workspaceId, this.workspaceId),
            like(schema.storedObjects.key, `${prefix.replace(/[%_]/g, '\\$&')}%`),
          ),
        )
        .returning({ key: schema.storedObjects.key });
      return result.length;
    });
  }
}

/**
 * Supabase Storage adapter.
 *
 * Uses the REST endpoint directly rather than the Supabase JS client so the worker
 * and web app keep one HTTP path and no extra runtime dependency. The service-role
 * key is server-only and never reaches a browser bundle.
 */
export class SupabaseObjectStore implements ObjectStore {
  readonly kind = 'supabase' as const;

  constructor(
    private readonly config: { url: string; serviceRoleKey: string; bucket: string },
    private readonly workspaceId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private path(key: string): string {
    return `${this.config.url.replace(/\/+$/, '')}/storage/v1/object/${this.config.bucket}/${this.workspaceId}/${key}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.serviceRoleKey}`,
      apikey: this.config.serviceRoleKey,
      ...extra,
    };
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const res = await this.fetchImpl(this.path(key), {
      method: 'POST',
      headers: this.headers({
        'content-type': 'application/octet-stream',
        'x-upsert': 'true',
      }),
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`Supabase Storage upload failed (${res.status})`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.fetchImpl(this.path(key), { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Supabase Storage download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.fetchImpl(this.path(key), { method: 'DELETE', headers: this.headers() });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Supabase Storage delete failed (${res.status})`);
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const listUrl = `${this.config.url.replace(/\/+$/, '')}/storage/v1/object/list/${this.config.bucket}`;
    const res = await this.fetchImpl(listUrl, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix: `${this.workspaceId}/${prefix}`, limit: 1000 }),
    });
    if (!res.ok) throw new Error(`Supabase Storage list failed (${res.status})`);
    const objects = (await res.json()) as Array<{ name: string }>;
    for (const object of objects) await this.delete(object.name);
    return objects.length;
  }
}

/** Rows-only accounting used by the deletion report. */
export async function countStoredObjects(handle: DbHandle, workspaceId: string): Promise<number> {
  return withSystem(handle, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.storedObjects)
      .where(eq(schema.storedObjects.workspaceId, workspaceId));
    return row?.n ?? 0;
  });
}
