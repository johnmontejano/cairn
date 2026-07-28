import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  TENANT_TABLES,
  memoryRepo,
  normalizeRows,
  schema,
  withSystem,
  withTenant,
} from '@cairn/db';
import { submitSource } from '@cairn/ingestion';
import { searchMemory } from '@cairn/search';
import { createTestWorld, type TestWorld } from '@cairn/testing';

/**
 * Tenant isolation.
 *
 * The product's whole premise is that this is *your* memory. These tests attack
 * that from three directions: the database's own row-level security, the
 * application's authorization, and the encryption that makes stolen bytes useless.
 */
describe('one workspace cannot reach another', () => {
  let world: TestWorld;
  let other: Awaited<ReturnType<TestWorld['otherWorkspace']>>;

  beforeAll(async () => {
    world = await createTestWorld();
    other = await world.otherWorkspace();

    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:private',
      title: 'Private notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(
        '# Private\n\nWe decided the supplier contract price is £0.62 per kilo.\n',
      ),
    });
    await world.drain();
  });
  afterAll(async () => {
    await world.close();
  });

  it('protects every tenant-owned table with row-level security', async () => {
    const rows = normalizeRows<{ tablename: string; rowsecurity: boolean }>(
      await world.handle.db.execute(
        sql`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`,
      ),
    );
    const byName = new Map(rows.map((r) => [r.tablename, r.rowsecurity]));
    for (const table of TENANT_TABLES) {
      expect(byName.get(table), `${table} must have row-level security enabled`).toBe(true);
    }
  });

  it('gives every tenant table an isolation policy targeting the application role', async () => {
    const policies = normalizeRows<{ tablename: string; policyname: string; roles: string }>(
      await world.handle.db.execute(
        sql`SELECT tablename, policyname, roles::text AS roles FROM pg_policies WHERE schemaname = 'public'`,
      ),
    );
    for (const table of TENANT_TABLES) {
      const policy = policies.find((p) => p.tablename === table);
      expect(policy, `${table} needs a policy`).toBeDefined();
      expect(policy!.roles).toContain('cairn_app');
    }
  });

  it('shows a workspace only its own rows, even with no WHERE clause', async () => {
    const mineSeenByMe = await withTenant(world.handle, world.actor, (tx) =>
      tx.select().from(schema.sourceItems),
    );
    expect(mineSeenByMe.length).toBeGreaterThan(0);

    // Deliberately no workspace filter: RLS must supply it.
    const mineSeenByThem = await withTenant(world.handle, other.actor, (tx) =>
      tx.select().from(schema.sourceItems),
    );
    expect(mineSeenByThem).toHaveLength(0);
  });

  it('hides memory, evidence, versions, and audit history across tenants', async () => {
    for (const table of [
      schema.memoryItems,
      schema.memoryEvidence,
      schema.vaultVersions,
      schema.auditEvents,
      schema.chunks,
      schema.jobs,
    ]) {
      const rows = await withTenant(world.handle, other.actor, (tx) => tx.select().from(table));
      expect(rows).toHaveLength(0);
    }
  });

  it('refuses to write a row belonging to another workspace', async () => {
    await expect(
      withTenant(world.handle, other.actor, async (tx) => {
        await tx.insert(schema.projects).values({
          id: '99999999-9999-4999-8999-999999999999',
          workspaceId: world.actor.workspaceId,
          name: 'Sneaky',
          slug: 'sneaky',
        });
      }),
    ).rejects.toThrow();
  });

  it("refuses to update another workspace's rows even when naming them exactly", async () => {
    const target = await withSystem(world.handle, (tx) =>
      tx.select().from(schema.memoryItems).limit(1),
    );
    expect(target.length).toBe(1);

    await withTenant(world.handle, other.actor, async (tx) => {
      const result = await tx
        .update(schema.memoryItems)
        .set({ status: 'approved' })
        .where(sql`id = ${target[0]!.id}`)
        .returning({ id: schema.memoryItems.id });
      expect(result).toHaveLength(0);
    });

    const after = await withSystem(world.handle, (tx) =>
      tx
        .select()
        .from(schema.memoryItems)
        .where(sql`id = ${target[0]!.id}`),
    );
    expect(after[0]!.status).toBe(target[0]!.status);
  });

  it('returns nothing when another workspace searches for the same words', async () => {
    const mineCrypto = await world.services.keyring.get(world.actor.workspaceId);
    const theirsCrypto = await world.services.keyring.get(other.workspaceId);

    const mine = await withTenant(world.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto: mineCrypto, embedder: world.services.embedder }, world.actor, {
        query: 'supplier contract price',
      }),
    );
    const theirs = await withTenant(world.handle, other.actor, (tx) =>
      searchMemory({ tx, crypto: theirsCrypto, embedder: world.services.embedder }, other.actor, {
        query: 'supplier contract price',
      }),
    );
    expect(theirs).toHaveLength(0);
    // `mine` may be empty until approval; the point is that theirs is never more.
    expect(theirs.length).toBeLessThanOrEqual(mine.length);
  });

  it("cannot decrypt another workspace's rows even holding the ciphertext", async () => {
    const rows = await withSystem(world.handle, (tx) =>
      tx.select().from(schema.memoryItems).limit(1),
    );
    const theirsCrypto = await world.services.keyring.get(other.workspaceId);
    expect(() =>
      theirsCrypto.decryptContent(rows[0]!.encryptedTitle, 'memory_title', rows[0]!.id),
    ).toThrow(/failed authentication/i);
  });

  it('stores nothing readable in the database itself', async () => {
    const rows = await withSystem(world.handle, (tx) => tx.select().from(schema.memoryItems));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const asText = Buffer.from(row.encryptedValue).toString('utf8');
      expect(asText).not.toContain('supplier');
      expect(asText).not.toContain('0.62');
    }
    const revisions = await withSystem(world.handle, (tx) =>
      tx.select().from(schema.sourceRevisions),
    );
    for (const revision of revisions) {
      const asText = Buffer.from(revision.encryptedNormalized ?? new Uint8Array()).toString('utf8');
      expect(asText).not.toContain('supplier contract');
    }
    const objects = await withSystem(world.handle, (tx) => tx.select().from(schema.storedObjects));
    expect(objects.length).toBeGreaterThan(0);
    for (const object of objects) {
      expect(Buffer.from(object.bytes).toString('utf8')).not.toContain('supplier contract');
    }
  });

  it('does not let a tenant read the sign-in tables', async () => {
    const sessions = await withTenant(world.handle, world.actor, (tx) =>
      tx.select().from(schema.sessions),
    );
    expect(sessions).toHaveLength(0);
    const challenges = await withTenant(world.handle, world.actor, (tx) =>
      tx.select().from(schema.authChallenges),
    );
    expect(challenges).toHaveLength(0);
  });

  it('scopes the tenant setting to the transaction, so a connection cannot leak it', async () => {
    await withTenant(world.handle, world.actor, async () => {});
    const after = normalizeRows<{ ws: string | null }>(
      await world.handle.db.execute(sql`SELECT current_setting('cairn.workspace_id', true) AS ws`),
    );
    expect(after[0]?.ws ?? '').toBe('');
  });

  it('keeps the decrypted memory reachable for its own workspace', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const items = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.value.includes('0.62'))).toBe(true);
  });
});
