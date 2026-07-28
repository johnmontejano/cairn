import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deletionRepo, memoryRepo, schema, withSystem, withTenant } from '@cairn/db';
import { approveMemoryItem, submitSource } from '@cairn/ingestion';
import { indexMemoryItems, searchMemory } from '@cairn/search';
import {
  createProjectBackup,
  exportProjectMarkdown,
  readZip,
  restoreBackup,
  verifyBackup,
} from '@cairn/vault';
import { createTestWorld, type TestWorld } from '@cairn/testing';

const PASSPHRASE = 'a passphrase long enough to be real';
const DOCUMENT = `# Bakery

We decided to sign the Mill Street lease.

Priya is running the kitchen.

Tom needs to chase the solicitor this week.
`;

/**
 * "I lost my computer."
 *
 * The test that matters is not that a restore runs, but that what comes back is
 * provably the same memory: identical fingerprints, working search, and citations
 * that still resolve to their sources.
 */
describe('losing everything and getting it back', () => {
  let world: TestWorld;
  let backup: Uint8Array;
  let originalIds: string[] = [];
  let originalManifestHash: string;

  beforeAll(async () => {
    world = await createTestWorld();
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:recovery',
      title: 'Bakery notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(DOCUMENT),
    });
    await world.drain();

    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const proposals = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    for (const proposal of proposals) {
      await approveMemoryItem(world.services, world.actor, {
        memoryItemId: proposal.id,
        projectId: world.project.id,
        authorLabel: 'Test Person',
      });
    }
    originalIds = proposals.map((p) => p.id).sort();

    const head = await world.services.vault.head({
      actor: world.actor,
      projectId: world.project.id,
    });
    originalManifestHash = head!.manifestHash;

    const created = await createProjectBackup(
      world.handle,
      world.services.keyring,
      world.services.vault,
      world.actor,
      { projectId: world.project.id, passphrase: PASSPHRASE, kind: 'manual' },
    );
    backup = created.bytes;
  });
  afterAll(async () => {
    await world.close();
  });

  it('produces a readable Markdown export that needs nothing to open', async () => {
    const exported = await exportProjectMarkdown(
      world.handle,
      world.services.keyring,
      world.services.vault,
      world.actor,
      world.project.id,
    );
    const files = readZip(exported.bytes);
    const names = files.map((f) => f.path);
    expect(names).toContain('README.md');
    expect(names).toContain('memory/DECISIONS.md');

    const decisions = files.find((f) => f.path === 'memory/DECISIONS.md')!;
    const text = Buffer.from(decisions.content as Uint8Array).toString('utf8');
    expect(text).toContain('Mill Street');
    expect(text.startsWith('# Decisions')).toBe(true);
  });

  it('records only a fingerprint of the backup, never the backup itself', async () => {
    const rows = await withSystem(world.handle, (tx) => tx.select().from(schema.backups));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.encryptedArchive).toBeNull();
    expect(rows[0]!.contentHash).toMatch(/^sha256:/);
    expect(rows[0]!.byteSize).toBe(backup.byteLength);
  });

  it('verifies a backup without changing anything', () => {
    const report = verifyBackup(backup, PASSPHRASE);
    expect(report.ok).toBe(true);
    expect(report.manifestHash.expected).toBe(originalManifestHash);
    expect(report.manifestHash.matches).toBe(true);
    expect(report.restored.memoryItems).toBe(originalIds.length);
  });

  it('restores into a completely separate account and reproduces the same fingerprint', async () => {
    // A different workspace, with a different data key: the closest thing to a
    // new computer and a new account that a test can build.
    const fresh = await world.otherWorkspace();

    const dryRun = await restoreBackup(world.handle, world.services.keyring, fresh.actor, {
      archive: backup,
      passphrase: PASSPHRASE,
      projectId: fresh.projectId,
      dryRun: true,
    });
    expect(dryRun.dryRun).toBe(true);
    const beforeRows = await withTenant(world.handle, fresh.actor, (tx) =>
      tx.select().from(schema.memoryItems),
    );
    expect(beforeRows).toHaveLength(0);

    const report = await restoreBackup(world.handle, world.services.keyring, fresh.actor, {
      archive: backup,
      passphrase: PASSPHRASE,
      projectId: fresh.projectId,
      authorLabel: 'Restore',
    });
    expect(report.ok).toBe(true);
    expect(report.restored.memoryItems).toBe(originalIds.length);
    // The proof: the restored documents hash to what the backup recorded.
    expect(report.manifestHash.actual).toBe(originalManifestHash);
    expect(report.manifestHash.matches).toBe(true);

    const crypto = await world.services.keyring.get(fresh.workspaceId);
    const restored = await withTenant(world.handle, fresh.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: fresh.workspaceId,
        projectId: fresh.projectId,
        statuses: ['approved'],
      }),
    );
    expect(restored.map((r) => r.id).sort()).toEqual(originalIds);
    expect(restored.some((r) => r.value.includes('Mill Street'))).toBe(true);

    // Citations still resolve to a real source after the restore.
    const evidence = await withTenant(world.handle, fresh.actor, (tx) =>
      memoryRepo.listEvidence(
        tx,
        crypto,
        fresh.workspaceId,
        restored.map((r) => r.id),
      ),
    );
    for (const item of restored) {
      const records = evidence.get(item.id) ?? [];
      expect(records.length, `${item.title} lost its evidence`).toBeGreaterThan(0);
      expect(records[0]!.excerpt.length).toBeGreaterThan(0);
    }

    // And search works again once the derived index is rebuilt.
    await withTenant(world.handle, fresh.actor, (tx) =>
      indexMemoryItems(tx, crypto, world.services.embedder, restored),
    );
    const results = await withTenant(world.handle, fresh.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, fresh.actor, {
        query: 'Which lease did we sign?',
      }),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.citations.length).toBeGreaterThan(0);
  });

  it('is idempotent: restoring the same backup twice converges', async () => {
    const fresh = await world.otherWorkspace();
    const options = {
      archive: backup,
      passphrase: PASSPHRASE,
      projectId: fresh.projectId,
    };
    await restoreBackup(world.handle, world.services.keyring, fresh.actor, options);
    await restoreBackup(world.handle, world.services.keyring, fresh.actor, options);

    const crypto = await world.services.keyring.get(fresh.workspaceId);
    const restored = await withTenant(world.handle, fresh.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: fresh.workspaceId,
        projectId: fresh.projectId,
        statuses: ['approved'],
      }),
    );
    expect(restored.map((r) => r.id).sort()).toEqual(originalIds);
  });

  it('refuses a backup that has been altered', () => {
    const altered = Buffer.from(backup);
    altered[altered.length - 3] = (altered[altered.length - 3] ?? 0) ^ 0x7f;
    expect(() => verifyBackup(altered, PASSPHRASE)).toThrow();
  });
});

describe('deleting everything means everything', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:delete-me',
      title: 'Sensitive notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode('# Notes\n\nWe decided the private detail is 12345.\n'),
    });
    await world.drain();
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const [proposal] = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    await approveMemoryItem(world.services, world.actor, {
      memoryItemId: proposal!.id,
      projectId: world.project.id,
      authorLabel: 'Test',
    });
  });
  afterAll(async () => {
    await world.close();
  });

  it('removes every trace and destroys the key that could read what is left', async () => {
    const workspaceId = world.actor.workspaceId;
    const before = await withSystem(world.handle, (tx) => tx.select().from(schema.memoryItems));
    expect(before.length).toBeGreaterThan(0);

    const report = await deletionRepo.deleteWorkspace(world.handle, workspaceId);
    expect(report.scope).toBe('workspace');
    expect(report.externalRemainders.length).toBeGreaterThan(0);

    for (const table of [
      schema.memoryItems,
      schema.memoryEvidence,
      schema.sourceItems,
      schema.sourceRevisions,
      schema.chunks,
      schema.vaultVersions,
      schema.vaultObjects,
      schema.storedObjects,
      schema.auditEvents,
      schema.jobs,
      schema.workspaceKeys,
    ]) {
      const rows = await withSystem(world.handle, (tx) => tx.select().from(table));
      const remaining = (rows as Array<{ workspaceId?: string }>).filter(
        (r) => r.workspaceId === workspaceId,
      );
      expect(remaining, `${JSON.stringify(rows).slice(0, 80)}`).toHaveLength(0);
    }

    const workspaces = await withSystem(world.handle, (tx) =>
      tx.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)),
    );
    expect(workspaces).toHaveLength(0);

    // Without the key row, nothing encrypted under it could be read even if a
    // stray copy of the bytes survived somewhere.
    world.services.keyring.forget(workspaceId);
    await expect(world.services.keyring.get(workspaceId)).rejects.toThrow(/not found/i);
  });

  it('says plainly what it cannot reach', async () => {
    const other = await world.otherWorkspace();
    const report = await deletionRepo.deleteWorkspace(world.handle, other.workspaceId);
    expect(report.externalRemainders.join(' ')).toMatch(/exported|AI tool/i);
  });
});

describe('disconnecting a source', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('destroys the stored permission but keeps memory already saved', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const connection = await withTenant(world.handle, world.actor, (tx) =>
      import('@cairn/db').then(({ sourcesRepo }) =>
        sourcesRepo.createConnection(tx, crypto, {
          workspaceId: world.actor.workspaceId,
          projectId: world.project.id,
          provider: 'google_drive',
          displayName: 'Google Drive',
          credential: JSON.stringify({ accessToken: 'ya29.super-secret', refreshToken: 'r' }),
        }),
      ),
    );

    const { sourcesRepo } = await import('@cairn/db');
    const before = await withTenant(world.handle, world.actor, (tx) =>
      sourcesRepo.readConnectionCredential(tx, crypto, world.actor.workspaceId, connection.id),
    );
    expect(before).toContain('ya29.super-secret');

    await withTenant(world.handle, world.actor, (tx) =>
      sourcesRepo.disconnectConnection(tx, world.actor.workspaceId, connection.id),
    );

    const after = await withTenant(world.handle, world.actor, (tx) =>
      sourcesRepo.readConnectionCredential(tx, crypto, world.actor.workspaceId, connection.id),
    );
    expect(after).toBeNull();

    const row = await withSystem(world.handle, (tx) =>
      tx
        .select()
        .from(schema.sourceConnections)
        .where(eq(schema.sourceConnections.id, connection.id)),
    );
    expect(row[0]!.state).toBe('disconnected');
    expect(row[0]!.encryptedCredential).toBeNull();
    expect(row[0]!.cursor).toBeNull();
    expect(row[0]!.disconnectedAt).not.toBeNull();
  });
});
