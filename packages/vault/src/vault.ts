import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { PRODUCT } from '@cairn/config';
import { contentHash as hashOf, manifestHash } from '@cairn/crypto';
import type { WorkspaceCrypto } from '@cairn/crypto';
import { type CairnTx, type DbHandle, type Keyring, schema, withTenant } from '@cairn/db';
import {
  type ActorContext,
  IntegrityError,
  type MemoryVault,
  NotFoundError,
  type Uuid,
  type VaultCommitChange,
  type VaultEntry,
  type VaultManifest,
  type VaultProvenance,
  type VaultVersion,
  ValidationError,
  requireRole,
} from '@cairn/domain';

/**
 * The canonical memory store.
 *
 * Every approved change appends an immutable version. A version is a manifest of
 * `path -> content hash`; the bytes themselves live once per distinct content in
 * `vault_objects`, encrypted. Two consequences that matter:
 *
 *  - History is cheap. Editing one document does not copy the others.
 *  - A version is verifiable. Re-hashing the stored bytes must reproduce the
 *    manifest hash recorded at commit time, which is what makes a restore
 *    provably faithful rather than merely successful.
 */
export class PostgresMemoryVault implements MemoryVault {
  constructor(
    private readonly handle: DbHandle,
    private readonly keyring: Keyring,
  ) {}

  async commit(input: {
    actor: ActorContext;
    projectId: Uuid;
    changes: VaultCommitChange[];
    reason: string;
    authorLabel: string;
    provenance: VaultProvenance;
  }): Promise<VaultVersion> {
    const crypto = await this.keyring.get(input.actor.workspaceId);
    return withTenant(this.handle, input.actor, (tx) => this.commitWithin(tx, crypto, input));
  }

  /**
   * Commit inside a caller's transaction.
   *
   * Approving a memory updates rows *and* writes a version, and those must
   * succeed or fail together. Opening a nested transaction to do the second half
   * would also deadlock on a single-connection database, so the transaction is
   * passed in rather than created here.
   */
  async commitWithin(
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
  ): Promise<VaultVersion> {
    requireRole(input.actor, 'member');
    if (input.changes.length === 0) throw new ValidationError('A version must change something');
    for (const change of input.changes) assertSafePath(change.path);

    {
      const [head] = await tx
        .select()
        .from(schema.vaultVersions)
        .where(
          and(
            eq(schema.vaultVersions.workspaceId, input.actor.workspaceId),
            eq(schema.vaultVersions.projectId, input.projectId),
          ),
        )
        .orderBy(desc(schema.vaultVersions.createdAt), desc(schema.vaultVersions.id))
        .limit(1);

      const entries = new Map<string, VaultEntry>(
        head ? (head.manifest as VaultManifest).entries.map((e) => [e.path, e]) : [],
      );

      for (const change of input.changes) {
        if (change.content === null) {
          entries.delete(change.path);
          continue;
        }
        const bytes = Buffer.from(change.content, 'utf8');
        const hash = hashOf(bytes);
        // Content-addressed: an unchanged document costs nothing to keep.
        await tx
          .insert(schema.vaultObjects)
          .values({
            workspaceId: input.actor.workspaceId,
            contentHash: hash,
            encryptedContent: crypto.encryptBlob(bytes, 'vault_object', hash),
            byteSize: bytes.byteLength,
          })
          .onConflictDoNothing();
        entries.set(change.path, {
          path: change.path,
          contentHash: hash,
          byteSize: bytes.byteLength,
        });
      }

      const manifest: VaultManifest = {
        version: PRODUCT.vaultManifestVersion,
        entries: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)),
      };
      const id = randomUUID();
      const [row] = await tx
        .insert(schema.vaultVersions)
        .values({
          id,
          workspaceId: input.actor.workspaceId,
          projectId: input.projectId,
          parentVersionId: head?.id ?? null,
          authorUserId: input.actor.userId,
          authorLabel: input.authorLabel,
          reason: input.reason,
          manifestHash: manifestHash(manifest.entries),
          manifest,
          provenance: input.provenance,
        })
        .returning();
      if (!row) throw new Error('Vault version insert returned no row');
      return toVersion(row);
    }
  }

  async read(input: {
    actor: ActorContext;
    projectId: Uuid;
    path: string;
    versionId?: Uuid;
  }): Promise<string | null> {
    const crypto = await this.keyring.get(input.actor.workspaceId);
    return withTenant(this.handle, input.actor, async (tx) => {
      const version = await this.resolveVersion(tx, input.actor, input.projectId, input.versionId);
      if (!version) return null;
      const entry = (version.manifest as VaultManifest).entries.find((e) => e.path === input.path);
      if (!entry) return null;
      return readObject(tx, crypto, input.actor.workspaceId, entry.contentHash);
    });
  }

  async list(input: {
    actor: ActorContext;
    projectId: Uuid;
    versionId?: Uuid;
  }): Promise<VaultManifest> {
    return withTenant(this.handle, input.actor, async (tx) => {
      const version = await this.resolveVersion(tx, input.actor, input.projectId, input.versionId);
      return version
        ? (version.manifest as VaultManifest)
        : { version: PRODUCT.vaultManifestVersion, entries: [] };
    });
  }

  async history(input: {
    actor: ActorContext;
    projectId: Uuid;
    limit?: number;
  }): Promise<VaultVersion[]> {
    return withTenant(this.handle, input.actor, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.vaultVersions)
        .where(
          and(
            eq(schema.vaultVersions.workspaceId, input.actor.workspaceId),
            eq(schema.vaultVersions.projectId, input.projectId),
          ),
        )
        .orderBy(desc(schema.vaultVersions.createdAt), desc(schema.vaultVersions.id))
        .limit(Math.min(input.limit ?? 50, 200));
      return rows.map(toVersion);
    });
  }

  async head(input: { actor: ActorContext; projectId: Uuid }): Promise<VaultVersion | null> {
    const [first] = await this.history({ ...input, limit: 1 });
    return first ?? null;
  }

  async getVersion(input: { actor: ActorContext; versionId: Uuid }): Promise<VaultVersion | null> {
    return withTenant(this.handle, input.actor, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.vaultVersions)
        .where(
          and(
            eq(schema.vaultVersions.workspaceId, input.actor.workspaceId),
            eq(schema.vaultVersions.id, input.versionId),
          ),
        )
        .limit(1);
      return row ? toVersion(row) : null;
    });
  }

  /**
   * Re-derives every hash from the stored bytes.
   *
   * This is the check behind "your backup is good": it proves the bytes on disk
   * still decrypt, still hash to what the manifest claims, and that the manifest
   * still hashes to what the version recorded.
   */
  async verify(input: {
    actor: ActorContext;
    projectId: Uuid;
    versionId?: Uuid;
  }): Promise<{ ok: boolean; checked: number; problems: string[] }> {
    const crypto = await this.keyring.get(input.actor.workspaceId);
    return withTenant(this.handle, input.actor, async (tx) => {
      const version = await this.resolveVersion(tx, input.actor, input.projectId, input.versionId);
      if (!version) return { ok: true, checked: 0, problems: [] };

      const manifest = version.manifest as VaultManifest;
      const problems: string[] = [];
      let checked = 0;

      for (const entry of manifest.entries) {
        checked += 1;
        let text: string | null;
        try {
          text = await readObject(tx, crypto, input.actor.workspaceId, entry.contentHash);
        } catch (error) {
          problems.push(`${entry.path}: could not be decrypted (${(error as Error).message})`);
          continue;
        }
        if (text === null) {
          problems.push(`${entry.path}: stored bytes are missing`);
          continue;
        }
        const actual = hashOf(Buffer.from(text, 'utf8'));
        if (actual !== entry.contentHash) {
          problems.push(`${entry.path}: content hash does not match the manifest`);
        }
      }

      const recomputed = manifestHash(manifest.entries);
      if (recomputed !== version.manifestHash) {
        problems.push('the manifest hash recorded with this version does not match its contents');
      }
      return { ok: problems.length === 0, checked, problems };
    });
  }

  /** Reads every file of a version at once — used by export and index rebuild. */
  async readAll(input: {
    actor: ActorContext;
    projectId: Uuid;
    versionId?: Uuid;
  }): Promise<{ version: VaultVersion | null; files: Array<{ path: string; content: string }> }> {
    const crypto = await this.keyring.get(input.actor.workspaceId);
    return withTenant(this.handle, input.actor, async (tx) => {
      const version = await this.resolveVersion(tx, input.actor, input.projectId, input.versionId);
      if (!version) return { version: null, files: [] };
      const files: Array<{ path: string; content: string }> = [];
      for (const entry of (version.manifest as VaultManifest).entries) {
        const content = await readObject(tx, crypto, input.actor.workspaceId, entry.contentHash);
        if (content === null) throw new IntegrityError(`Missing vault object for ${entry.path}`);
        files.push({ path: entry.path, content });
      }
      return { version: toVersion(version), files };
    });
  }

  private async resolveVersion(
    tx: CairnTx,
    actor: ActorContext,
    projectId: Uuid,
    versionId?: Uuid,
  ): Promise<typeof schema.vaultVersions.$inferSelect | null> {
    if (versionId) {
      const [row] = await tx
        .select()
        .from(schema.vaultVersions)
        .where(
          and(
            eq(schema.vaultVersions.workspaceId, actor.workspaceId),
            eq(schema.vaultVersions.id, versionId),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundError('memory version');
      if (row.projectId !== projectId) throw new NotFoundError('memory version');
      return row;
    }
    const [row] = await tx
      .select()
      .from(schema.vaultVersions)
      .where(
        and(
          eq(schema.vaultVersions.workspaceId, actor.workspaceId),
          eq(schema.vaultVersions.projectId, projectId),
        ),
      )
      .orderBy(desc(schema.vaultVersions.createdAt), desc(schema.vaultVersions.id))
      .limit(1);
    return row ?? null;
  }
}

async function readObject(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  workspaceId: string,
  contentHash: string,
): Promise<string | null> {
  const [obj] = await tx
    .select()
    .from(schema.vaultObjects)
    .where(
      and(
        eq(schema.vaultObjects.workspaceId, workspaceId),
        eq(schema.vaultObjects.contentHash, contentHash),
      ),
    )
    .limit(1);
  if (!obj) return null;
  return Buffer.from(
    crypto.decryptBlob(obj.encryptedContent, 'vault_object', contentHash),
  ).toString('utf8');
}

function toVersion(row: typeof schema.vaultVersions.$inferSelect): VaultVersion {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    parentVersionId: row.parentVersionId,
    authorUserId: row.authorUserId,
    authorLabel: row.authorLabel,
    reason: row.reason,
    manifestHash: row.manifestHash,
    createdAt: row.createdAt,
    provenance: row.provenance as VaultProvenance,
  };
}

/** Paths are product-controlled; this rejects anything that could escape the vault. */
export function assertSafePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 300 ||
    path.startsWith('/') ||
    path.includes('..') ||
    path.includes('\\') ||
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    /[\u0000-\u001f]/.test(path)
  ) {
    throw new ValidationError(`Unsafe vault path: ${path}`);
  }
}
