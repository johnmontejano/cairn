import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { contentHash, manifestHash } from '@cairn/crypto';
import { type DbHandle, type Keyring, memoryRepo, schema, withTenant } from '@cairn/db';
import {
  type ActorContext,
  type MemoryType,
  type SensitivityLevel,
  type ClientVisibilityPolicy,
  type ExtractionMethod,
  type Uuid,
  IntegrityError,
} from '@cairn/domain';
import { type BackupPayload, inspectBackupArchive } from './backup';

/**
 * Restoring after losing everything.
 *
 * The check that matters is not "did rows get inserted" but "does the restored
 * memory hash to the same thing it did before". The manifest hash is recomputed
 * from the restored documents and compared against the value recorded when the
 * backup was made; a mismatch is reported rather than swallowed, because a
 * restore you cannot trust is worse than no restore.
 */

export interface RestoreReport {
  dryRun: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  restored: { memoryItems: number; evidence: number; documents: number; sources: number };
  manifestHash: { expected: string | null; actual: string | null; matches: boolean };
  ok: boolean;
}

export function verifyBackup(archive: Uint8Array, passphrase: string): RestoreReport {
  const { payload, checks } = inspectBackupArchive(archive, passphrase);
  const actual = manifestHash(
    payload.files.map((f) => ({ path: f.path, contentHash: f.contentHash })),
  );
  const expected = payload.version?.manifestHash ?? null;
  const matches = expected === null || expected === actual;

  return {
    dryRun: true,
    checks: [
      ...checks,
      {
        name: 'Memory version fingerprint',
        ok: matches,
        detail: matches
          ? 'The documents in this backup match the version fingerprint recorded when it was made.'
          : `Expected ${expected}, computed ${actual}.`,
      },
    ],
    restored: {
      memoryItems: payload.memory.length,
      evidence: payload.memory.reduce((n, m) => n + m.evidence.length, 0),
      documents: payload.files.length,
      sources: payload.sources.length,
    },
    manifestHash: { expected, actual, matches },
    ok: checks.every((c) => c.ok) && matches,
  };
}

/**
 * Writes a backup into a workspace.
 *
 * Existing rows with the same identifiers are replaced, so restoring twice
 * converges rather than duplicating. Everything is re-encrypted under the target
 * workspace's key, which is what makes restoring into a *different* account work
 * at all.
 */
export async function restoreBackup(
  handle: DbHandle,
  keyring: Keyring,
  actor: ActorContext,
  input: {
    archive: Uint8Array;
    passphrase: string;
    projectId: Uuid;
    dryRun?: boolean;
    authorLabel?: string;
  },
): Promise<RestoreReport> {
  const report = verifyBackup(input.archive, input.passphrase);
  if (input.dryRun) return report;
  if (!report.ok) {
    throw new IntegrityError(
      `Backup failed verification: ${report.checks
        .filter((c) => !c.ok)
        .map((c) => c.detail)
        .join('; ')}`,
    );
  }

  const { payload } = inspectBackupArchive(input.archive, input.passphrase);
  const crypto = await keyring.get(actor.workspaceId);

  const counts = await withTenant(handle, actor, async (tx) => {
    let evidenceCount = 0;

    for (const source of payload.sources) {
      await tx
        .insert(schema.sourceItems)
        .values({
          id: source.id,
          workspaceId: actor.workspaceId,
          projectId: input.projectId,
          connectionId: null,
          provider: source.provider,
          externalId: source.externalId,
          title: source.title,
          mimeType: source.mimeType,
          canonicalUri: source.canonicalUri,
        })
        .onConflictDoNothing();
      for (const revision of source.revisions) {
        await tx
          .insert(schema.sourceRevisions)
          .values({
            id: revision.id,
            workspaceId: actor.workspaceId,
            sourceItemId: source.id,
            externalRevision: revision.externalRevision,
            contentHash: revision.contentHash,
            byteSize: revision.byteSize,
            // The original body is not in the backup by design; the excerpt in each
            // evidence record is what a citation actually shows.
            normalizedChars: 0,
            storageKey: null,
            encryptedNormalized: null,
            importedAt: new Date(revision.importedAt),
          })
          .onConflictDoNothing();
      }
    }

    for (const memory of payload.memory) {
      await tx
        .delete(schema.memoryItems)
        .where(
          and(
            eq(schema.memoryItems.workspaceId, actor.workspaceId),
            eq(schema.memoryItems.id, memory.id),
          ),
        );
      await memoryRepo.insertMemoryItem(tx, crypto, {
        id: memory.id,
        workspaceId: actor.workspaceId,
        projectId: input.projectId,
        type: memory.type as MemoryType,
        status: 'approved',
        title: memory.title,
        value: memory.value,
        topics: memory.topics,
        sensitivity: memory.sensitivity as SensitivityLevel,
        visibility: memory.visibility as ClientVisibilityPolicy,
        observedAt: memory.observedAt ? new Date(memory.observedAt) : null,
        extractionMethod: memory.extractionMethod as ExtractionMethod,
        extractionModel: memory.extractionModel,
      });
      // Timestamps are restored, not regenerated: the canonical Markdown embeds
      // them, so regenerating would change the bytes and break the fingerprint.
      await tx
        .update(schema.memoryItems)
        .set({
          updatedAt: new Date(memory.updatedAt),
          importedAt: new Date(memory.importedAt),
          canonicalPath: memory.canonicalPath,
        })
        .where(
          and(
            eq(schema.memoryItems.workspaceId, actor.workspaceId),
            eq(schema.memoryItems.id, memory.id),
          ),
        );

      for (const evidence of memory.evidence) {
        await memoryRepo.addEvidence(tx, crypto, {
          workspaceId: actor.workspaceId,
          memoryItemId: memory.id,
          sourceItemId: evidence.sourceItemId,
          sourceRevisionId: evidence.sourceRevisionId,
          startOffset: evidence.startOffset,
          endOffset: evidence.endOffset,
          excerpt: evidence.excerpt,
          locator: evidence.locator,
        });
        evidenceCount += 1;
      }
    }

    // The documents from the backup become a real version in the target vault, so
    // history continues rather than restarting.
    const entries: Array<{ path: string; contentHash: string; byteSize: number }> = [];
    for (const file of payload.files) {
      const bytes = Buffer.from(file.content, 'utf8');
      const hash = contentHash(bytes);
      if (hash !== file.contentHash) {
        throw new IntegrityError(`Restored document ${file.path} does not match its fingerprint`);
      }
      await tx
        .insert(schema.vaultObjects)
        .values({
          workspaceId: actor.workspaceId,
          contentHash: hash,
          encryptedContent: crypto.encryptBlob(bytes, 'vault_object', hash),
          byteSize: bytes.byteLength,
        })
        .onConflictDoNothing();
      entries.push({ path: file.path, contentHash: hash, byteSize: bytes.byteLength });
    }

    const [head] = await tx
      .select({ id: schema.vaultVersions.id })
      .from(schema.vaultVersions)
      .where(
        and(
          eq(schema.vaultVersions.workspaceId, actor.workspaceId),
          eq(schema.vaultVersions.projectId, input.projectId),
        ),
      )
      .orderBy(schema.vaultVersions.createdAt)
      .limit(1);

    const versionId = randomUUID();
    const sorted = entries.sort((a, b) => a.path.localeCompare(b.path));
    await tx.insert(schema.vaultVersions).values({
      id: versionId,
      workspaceId: actor.workspaceId,
      projectId: input.projectId,
      parentVersionId: head?.id ?? null,
      authorUserId: actor.userId,
      authorLabel: input.authorLabel ?? 'Restore',
      reason: `Restored from a backup made on ${payload.version?.createdAt?.slice(0, 10) ?? 'an earlier date'}`,
      manifestHash: manifestHash(sorted),
      manifest: { version: 1, entries: sorted },
      provenance: { kind: 'restore', note: `Original version ${payload.version?.id ?? 'unknown'}` },
    });

    await tx
      .update(schema.memoryItems)
      .set({ canonicalVersionId: versionId })
      .where(
        and(
          eq(schema.memoryItems.workspaceId, actor.workspaceId),
          eq(schema.memoryItems.projectId, input.projectId),
        ),
      );

    return {
      memoryItems: payload.memory.length,
      evidence: evidenceCount,
      documents: payload.files.length,
      sources: payload.sources.length,
      versionId,
      restoredManifestHash: manifestHash(sorted),
    };
  });

  return {
    ...report,
    dryRun: false,
    restored: {
      memoryItems: counts.memoryItems,
      evidence: counts.evidence,
      documents: counts.documents,
      sources: counts.sources,
    },
    manifestHash: {
      expected: report.manifestHash.expected,
      actual: counts.restoredManifestHash,
      matches:
        report.manifestHash.expected === null ||
        report.manifestHash.expected === counts.restoredManifestHash,
    },
  };
}

export function summarizeBackupPayload(payload: BackupPayload): string {
  return [
    `${payload.memory.length} saved memories`,
    `${payload.files.length} documents`,
    `${payload.sources.length} sources`,
    `${payload.history.length} versions of history`,
  ].join(', ');
}
