import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { PRODUCT } from '@cairn/config';
import { contentHash } from '@cairn/crypto';
import {
  type DbHandle,
  type Keyring,
  memoryRepo,
  schema,
  sourcesRepo,
  withTenant,
} from '@cairn/db';
import { type ActorContext, type MemoryVault, type Uuid, renderExportReadme } from '@cairn/domain';
import { type BackupPayload, createBackupArchive } from './backup';
import { PostgresMemoryVault } from './vault';
import { createZip } from './zip';

/**
 * Two ways out of this product, both of which must always work.
 *
 * The readable export is plain Markdown in a zip — it needs nothing to open and
 * has no dependency on this software existing. The encrypted backup is the
 * recovery artifact: it carries the provenance and hashes needed to restore, and
 * only the person's passphrase can open it.
 */

export async function buildExportPayload(
  handle: DbHandle,
  keyring: Keyring,
  vault: MemoryVault,
  actor: ActorContext,
  projectId: Uuid,
): Promise<BackupPayload> {
  const crypto = await keyring.get(actor.workspaceId);
  const readAll = await (vault as PostgresMemoryVault).readAll({ actor, projectId });

  return withTenant(handle, actor, async (tx) => {
    const [workspace] = await tx
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, actor.workspaceId))
      .limit(1);
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(
        and(eq(schema.projects.workspaceId, actor.workspaceId), eq(schema.projects.id, projectId)),
      )
      .limit(1);
    if (!workspace || !project) throw new Error('Workspace or project is missing');

    const items = await memoryRepo.listMemoryItems(tx, crypto, {
      workspaceId: actor.workspaceId,
      projectId,
      statuses: ['approved'],
      limit: 1000,
    });
    const evidenceByItem = await memoryRepo.listEvidence(
      tx,
      crypto,
      actor.workspaceId,
      items.map((i) => i.id),
    );
    const allEvidence = [...evidenceByItem.values()].flat();
    const sourceItems = await sourcesRepo.getSourceItems(tx, actor.workspaceId, [
      ...new Set(allEvidence.map((e) => e.sourceItemId)),
    ]);
    const revisions = await sourcesRepo.getRevisions(tx, actor.workspaceId, [
      ...new Set(allEvidence.map((e) => e.sourceRevisionId)),
    ]);

    const history = await tx
      .select()
      .from(schema.vaultVersions)
      .where(
        and(
          eq(schema.vaultVersions.workspaceId, actor.workspaceId),
          eq(schema.vaultVersions.projectId, projectId),
        ),
      )
      .orderBy(desc(schema.vaultVersions.createdAt))
      .limit(200);

    const sources = [...sourceItems.values()].map((item) => ({
      id: item.id,
      provider: item.provider,
      externalId: item.externalId,
      title: item.title,
      mimeType: item.mimeType,
      canonicalUri: item.canonicalUri,
      revisions: [...revisions.values()]
        .filter((r) => r.sourceItemId === item.id)
        .map((r) => ({
          id: r.id,
          contentHash: r.contentHash,
          externalRevision: r.externalRevision,
          byteSize: r.byteSize,
          importedAt: r.importedAt.toISOString(),
        })),
    }));

    return {
      formatVersion: PRODUCT.backupFormatVersion,
      workspace: { id: workspace.id, name: workspace.name },
      project: { id: project.id, name: project.name, slug: project.slug },
      version: readAll.version
        ? {
            id: readAll.version.id,
            manifestHash: readAll.version.manifestHash,
            createdAt: readAll.version.createdAt.toISOString(),
            reason: readAll.version.reason,
            authorLabel: readAll.version.authorLabel,
          }
        : null,
      files: readAll.files.map((f) => ({
        path: f.path,
        content: f.content,
        contentHash: contentHash(f.content),
      })),
      sources,
      memory: items.map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        title: item.title,
        value: item.value,
        topics: item.topics,
        sensitivity: item.sensitivity,
        visibility: item.visibility,
        observedAt: item.observedAt?.toISOString() ?? null,
        updatedAt: item.updatedAt.toISOString(),
        importedAt: item.importedAt.toISOString(),
        extractionMethod: item.extractionMethod,
        extractionModel: item.extractionModel,
        canonicalPath: item.canonicalPath,
        canonicalVersionId: item.canonicalVersionId,
        evidence: (evidenceByItem.get(item.id) ?? []).map((e) => ({
          sourceProvider: sourceItems.get(e.sourceItemId)?.provider ?? 'paste',
          sourceTitle: sourceItems.get(e.sourceItemId)?.title ?? 'Unknown source',
          sourceItemId: e.sourceItemId,
          sourceRevisionId: e.sourceRevisionId,
          locator: e.locator,
          startOffset: e.startOffset,
          endOffset: e.endOffset,
          excerpt: e.excerpt,
          contentHash: e.contentHash,
          importedAt: (revisions.get(e.sourceRevisionId)?.importedAt ?? e.createdAt).toISOString(),
        })),
      })),
      history: history.map((v) => ({
        id: v.id,
        parentVersionId: v.parentVersionId,
        manifestHash: v.manifestHash,
        reason: v.reason,
        authorLabel: v.authorLabel,
        createdAt: v.createdAt.toISOString(),
        provenance: v.provenance,
      })),
    } satisfies BackupPayload;
  });
}

/** The plain-Markdown export: no encryption, no product needed to read it. */
export function buildMarkdownZip(payload: BackupPayload): Uint8Array {
  const readme = renderExportReadme({
    workspaceName: payload.workspace.name,
    projectName: payload.project.name,
    exportedAt: new Date(),
    versionId: payload.version?.id ?? null,
    itemCount: payload.memory.length,
  });
  return createZip([
    { path: 'README.md', content: readme },
    ...payload.files.map((f) => ({ path: f.path, content: f.content })),
  ]);
}

export async function exportProjectMarkdown(
  handle: DbHandle,
  keyring: Keyring,
  vault: MemoryVault,
  actor: ActorContext,
  projectId: Uuid,
): Promise<{ bytes: Uint8Array; filename: string; itemCount: number }> {
  const payload = await buildExportPayload(handle, keyring, vault, actor, projectId);
  return {
    bytes: buildMarkdownZip(payload),
    filename: `${payload.project.slug}-memory-${new Date().toISOString().slice(0, 10)}.zip`,
    itemCount: payload.memory.length,
  };
}

export async function createProjectBackup(
  handle: DbHandle,
  keyring: Keyring,
  vault: MemoryVault,
  actor: ActorContext,
  input: { projectId: Uuid; passphrase: string; kind: 'manual' | 'scheduled'; note?: string },
): Promise<{ bytes: Uint8Array; filename: string; backupId: Uuid; contentHash: string }> {
  const payload = await buildExportPayload(handle, keyring, vault, actor, input.projectId);
  const bytes = createBackupArchive(payload, input.passphrase);
  const hash = contentHash(bytes);
  const backupId = randomUUID();

  await withTenant(handle, actor, async (tx) => {
    // Only the fingerprint and size are recorded, never the archive or the
    // passphrase: a server-side copy of a passphrase-encrypted backup would
    // quietly undo the reason it is passphrase-encrypted.
    await tx.insert(schema.backups).values({
      id: backupId,
      workspaceId: actor.workspaceId,
      projectId: input.projectId,
      kind: input.kind,
      formatVersion: PRODUCT.backupFormatVersion,
      byteSize: bytes.byteLength,
      contentHash: hash,
      versionId: payload.version?.id ?? null,
      createdBy: actor.userId,
      note: input.note ?? null,
    });
  });

  return {
    bytes,
    filename: `${payload.project.slug}-${new Date().toISOString().slice(0, 10)}.cairnbackup`,
    backupId,
    contentHash: hash,
  };
}

export async function listBackups(handle: DbHandle, actor: ActorContext, projectId?: Uuid) {
  return withTenant(handle, actor, async (tx) => {
    const conditions = [eq(schema.backups.workspaceId, actor.workspaceId)];
    if (projectId) conditions.push(eq(schema.backups.projectId, projectId));
    return tx
      .select({
        id: schema.backups.id,
        kind: schema.backups.kind,
        byteSize: schema.backups.byteSize,
        contentHash: schema.backups.contentHash,
        createdAt: schema.backups.createdAt,
        note: schema.backups.note,
        versionId: schema.backups.versionId,
      })
      .from(schema.backups)
      .where(and(...conditions))
      .orderBy(desc(schema.backups.createdAt))
      .limit(50);
  });
}

/** Used by deletion reporting to say how many sources a project still holds. */
export async function countProjectSources(
  handle: DbHandle,
  actor: ActorContext,
  projectId: Uuid,
): Promise<number> {
  return withTenant(handle, actor, async (tx) => {
    const rows = await tx
      .select({ id: schema.sourceItems.id })
      .from(schema.sourceItems)
      .where(
        and(
          eq(schema.sourceItems.workspaceId, actor.workspaceId),
          eq(schema.sourceItems.projectId, projectId),
        ),
      );
    return rows.length;
  });
}

export { inArray };
