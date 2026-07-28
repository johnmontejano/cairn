import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceCrypto } from '@cairn/crypto';
import { contentHash } from '@cairn/crypto';
import type {
  ConnectionState,
  SourceConnection,
  SourceItem,
  SourceProvider,
  SourceRevision,
  Uuid,
} from '@cairn/domain';
import type { CairnTx } from '../client';
import * as schema from '../schema';

/* ----------------------------- connections ------------------------------- */

export async function createConnection(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  input: {
    workspaceId: Uuid;
    projectId: Uuid;
    provider: SourceProvider;
    displayName: string;
    state?: ConnectionState;
    scopes?: string[];
    credential?: string | null;
    externalAccountLabel?: string | null;
  },
): Promise<SourceConnection> {
  const id = randomUUID();
  const [row] = await tx
    .insert(schema.sourceConnections)
    .values({
      id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      provider: input.provider,
      displayName: input.displayName,
      state: input.state ?? 'active',
      scopes: input.scopes ?? [],
      externalAccountLabel: input.externalAccountLabel ?? null,
      encryptedCredential: input.credential ? crypto.encryptCredential(input.credential, id) : null,
    })
    .returning();
  if (!row) throw new Error('connection insert returned no row');
  return toConnection(row);
}

export async function listConnections(
  tx: CairnTx,
  workspaceId: Uuid,
  projectId?: Uuid,
): Promise<SourceConnection[]> {
  const conditions = [eq(schema.sourceConnections.workspaceId, workspaceId)];
  if (projectId) conditions.push(eq(schema.sourceConnections.projectId, projectId));
  const rows = await tx
    .select()
    .from(schema.sourceConnections)
    .where(and(...conditions))
    .orderBy(desc(schema.sourceConnections.createdAt));
  return rows.map(toConnection);
}

export async function getConnection(
  tx: CairnTx,
  workspaceId: Uuid,
  id: Uuid,
): Promise<SourceConnection | null> {
  const [row] = await tx
    .select()
    .from(schema.sourceConnections)
    .where(
      and(
        eq(schema.sourceConnections.workspaceId, workspaceId),
        eq(schema.sourceConnections.id, id),
      ),
    )
    .limit(1);
  return row ? toConnection(row) : null;
}

export async function readConnectionCredential(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  workspaceId: Uuid,
  id: Uuid,
): Promise<string | null> {
  const [row] = await tx
    .select({ encryptedCredential: schema.sourceConnections.encryptedCredential })
    .from(schema.sourceConnections)
    .where(
      and(
        eq(schema.sourceConnections.workspaceId, workspaceId),
        eq(schema.sourceConnections.id, id),
      ),
    )
    .limit(1);
  if (!row?.encryptedCredential) return null;
  return crypto.decryptCredential(row.encryptedCredential, id);
}

/**
 * Disconnect. Stops future imports and destroys the stored credential, but
 * deliberately keeps already-imported memory — with the UI saying so plainly.
 * Removing the memory is a separate, explicit choice.
 */
export async function disconnectConnection(
  tx: CairnTx,
  workspaceId: Uuid,
  id: Uuid,
): Promise<void> {
  await tx
    .update(schema.sourceConnections)
    .set({
      state: 'disconnected',
      encryptedCredential: null,
      cursor: null,
      disconnectedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.sourceConnections.workspaceId, workspaceId),
        eq(schema.sourceConnections.id, id),
      ),
    );
}

export async function updateConnectionState(
  tx: CairnTx,
  workspaceId: Uuid,
  id: Uuid,
  patch: {
    state?: ConnectionState;
    cursor?: string | null;
    lastError?: string | null;
    synced?: boolean;
  },
): Promise<void> {
  await tx
    .update(schema.sourceConnections)
    .set({
      state: patch.state,
      cursor: patch.cursor,
      lastError: patch.lastError,
      lastSyncedAt: patch.synced ? sql`now()` : undefined,
    })
    .where(
      and(
        eq(schema.sourceConnections.workspaceId, workspaceId),
        eq(schema.sourceConnections.id, id),
      ),
    );
}

function toConnection(row: typeof schema.sourceConnections.$inferSelect): SourceConnection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    provider: row.provider as SourceProvider,
    displayName: row.displayName,
    state: row.state as ConnectionState,
    scopes: row.scopes ?? [],
    cursor: row.cursor,
    externalAccountLabel: row.externalAccountLabel,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    disconnectedAt: row.disconnectedAt,
  };
}

/* ------------------------------ source items ----------------------------- */

export async function upsertSourceItem(
  tx: CairnTx,
  input: {
    workspaceId: Uuid;
    projectId: Uuid;
    connectionId: Uuid | null;
    provider: SourceProvider;
    externalId: string;
    title: string;
    mimeType: string;
    canonicalUri: string | null;
  },
): Promise<SourceItem> {
  const [row] = await tx
    .insert(schema.sourceItems)
    .values({ id: randomUUID(), ...input })
    .onConflictDoUpdate({
      target: [
        schema.sourceItems.workspaceId,
        schema.sourceItems.provider,
        schema.sourceItems.externalId,
      ],
      set: {
        title: input.title,
        mimeType: input.mimeType,
        canonicalUri: input.canonicalUri,
        connectionId: input.connectionId,
        deletedAt: null,
      },
    })
    .returning();
  if (!row) throw new Error('source item upsert returned no row');
  return toSourceItem(row);
}

export async function getSourceItems(
  tx: CairnTx,
  workspaceId: Uuid,
  ids: Uuid[],
): Promise<Map<Uuid, SourceItem>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.sourceItems)
    .where(
      and(eq(schema.sourceItems.workspaceId, workspaceId), inArray(schema.sourceItems.id, ids)),
    );
  return new Map(rows.map((r) => [r.id, toSourceItem(r)]));
}

export async function listSourceItems(
  tx: CairnTx,
  workspaceId: Uuid,
  projectId?: Uuid,
  limit = 100,
): Promise<SourceItem[]> {
  const conditions = [
    eq(schema.sourceItems.workspaceId, workspaceId),
    isNull(schema.sourceItems.deletedAt),
  ];
  if (projectId) conditions.push(eq(schema.sourceItems.projectId, projectId));
  const rows = await tx
    .select()
    .from(schema.sourceItems)
    .where(and(...conditions))
    .orderBy(desc(schema.sourceItems.createdAt))
    .limit(limit);
  return rows.map(toSourceItem);
}

function toSourceItem(row: typeof schema.sourceItems.$inferSelect): SourceItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    connectionId: row.connectionId,
    provider: row.provider as SourceProvider,
    externalId: row.externalId,
    title: row.title,
    mimeType: row.mimeType,
    canonicalUri: row.canonicalUri,
    currentRevisionId: row.currentRevisionId,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

/* ---------------------------- source revisions --------------------------- */

/**
 * Stores an immutable snapshot of one version of a source.
 *
 * Returns `created: false` when the same bytes were already stored for this item,
 * which is how repeated webhooks, re-uploads, and retried jobs stop being work.
 */
export async function upsertSourceRevision(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  input: {
    workspaceId: Uuid;
    sourceItemId: Uuid;
    externalRevision: string | null;
    rawBytes: Uint8Array;
    normalizedText: string;
    storageKey: string | null;
  },
): Promise<{ revision: SourceRevision; created: boolean }> {
  const hash = contentHash(input.rawBytes);
  const existing = await tx
    .select()
    .from(schema.sourceRevisions)
    .where(
      and(
        eq(schema.sourceRevisions.workspaceId, input.workspaceId),
        eq(schema.sourceRevisions.sourceItemId, input.sourceItemId),
        eq(schema.sourceRevisions.contentHash, hash),
      ),
    )
    .limit(1);
  if (existing[0]) return { revision: toRevision(existing[0]), created: false };

  const id = randomUUID();
  const [row] = await tx
    .insert(schema.sourceRevisions)
    .values({
      id,
      workspaceId: input.workspaceId,
      sourceItemId: input.sourceItemId,
      externalRevision: input.externalRevision,
      contentHash: hash,
      byteSize: input.rawBytes.byteLength,
      normalizedChars: input.normalizedText.length,
      storageKey: input.storageKey,
      encryptedNormalized: crypto.encryptContent(input.normalizedText, 'source_normalized', id),
    })
    .returning();
  if (!row) throw new Error('source revision insert returned no row');

  await tx
    .update(schema.sourceItems)
    .set({ currentRevisionId: id })
    .where(
      and(
        eq(schema.sourceItems.workspaceId, input.workspaceId),
        eq(schema.sourceItems.id, input.sourceItemId),
      ),
    );
  return { revision: toRevision(row), created: true };
}

export async function readNormalizedText(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  workspaceId: Uuid,
  revisionId: Uuid,
): Promise<string | null> {
  const [row] = await tx
    .select()
    .from(schema.sourceRevisions)
    .where(
      and(
        eq(schema.sourceRevisions.workspaceId, workspaceId),
        eq(schema.sourceRevisions.id, revisionId),
      ),
    )
    .limit(1);
  if (!row?.encryptedNormalized) return null;
  return crypto.decryptContent(row.encryptedNormalized, 'source_normalized', row.id);
}

export async function getRevisions(
  tx: CairnTx,
  workspaceId: Uuid,
  ids: Uuid[],
): Promise<Map<Uuid, SourceRevision>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.sourceRevisions)
    .where(
      and(
        eq(schema.sourceRevisions.workspaceId, workspaceId),
        inArray(schema.sourceRevisions.id, ids),
      ),
    );
  return new Map(rows.map((r) => [r.id, toRevision(r)]));
}

function toRevision(row: typeof schema.sourceRevisions.$inferSelect): SourceRevision {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceItemId: row.sourceItemId,
    externalRevision: row.externalRevision,
    contentHash: row.contentHash,
    byteSize: row.byteSize,
    normalizedChars: row.normalizedChars,
    storageKey: row.storageKey,
    importedAt: row.importedAt,
  };
}
