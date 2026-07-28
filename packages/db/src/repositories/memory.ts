import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceCrypto } from '@cairn/crypto';
import { contentHash } from '@cairn/crypto';
import {
  type ClientVisibilityPolicy,
  type ExtractionMethod,
  type MemoryEvidence,
  type MemoryItem,
  type MemoryStatus,
  type MemoryType,
  type SensitivityLevel,
  type Uuid,
  normalizeValue,
  normalizedTokens,
} from '@cairn/domain';
import type { CairnTx } from '../client';
import * as schema from '../schema';

/**
 * Memory items, encrypted at rest.
 *
 * Titles and values never touch a database column in plaintext. What the database
 * can still do is match: `normalized_hash` is a keyed hash used for duplicate
 * detection, and `memory_blind_terms` holds keyed term hashes used for exact
 * keyword search. Both are useless without the workspace key.
 */

export interface NewMemoryItem {
  workspaceId: Uuid;
  projectId: Uuid;
  type: MemoryType;
  status: MemoryStatus;
  title: string;
  value: string;
  topics: string[];
  sensitivity: SensitivityLevel;
  visibility?: ClientVisibilityPolicy;
  observedAt?: Date | null;
  extractionMethod: ExtractionMethod;
  extractionModel?: string | null;
  extractionPromptVersion?: string | null;
  extractionSchemaVersion?: string | null;
  confidence?: number | null;
  supersedesId?: Uuid | null;
  conflictGroupId?: Uuid | null;
  id?: Uuid;
}

type Row = typeof schema.memoryItems.$inferSelect;

export function decryptMemoryRow(crypto: WorkspaceCrypto, row: Row): MemoryItem {
  const title = crypto.decryptContent(row.encryptedTitle, 'memory_title', row.id);
  const value = crypto.decryptContent(row.encryptedValue, 'memory_value', row.id);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    type: row.type as MemoryType,
    status: row.status as MemoryStatus,
    value,
    normalizedValue: normalizeValue(value),
    title,
    topics: row.topics ?? [],
    sensitivity: row.sensitivity as SensitivityLevel,
    visibility: row.visibility as ClientVisibilityPolicy,
    observedAt: row.observedAt,
    importedAt: row.importedAt,
    validFrom: row.validFrom,
    validTo: row.validTo,
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    conflictGroupId: row.conflictGroupId,
    extractionMethod: row.extractionMethod as ExtractionMethod,
    extractionModel: row.extractionModel,
    extractionPromptVersion: row.extractionPromptVersion,
    extractionSchemaVersion: row.extractionSchemaVersion,
    confidence: row.confidence,
    canonicalPath: row.canonicalPath,
    canonicalVersionId: row.canonicalVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertMemoryItem(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  input: NewMemoryItem,
): Promise<MemoryItem> {
  const id = input.id ?? randomUUID();
  const normalized = normalizeValue(input.value);
  const [row] = await tx
    .insert(schema.memoryItems)
    .values({
      id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      type: input.type,
      status: input.status,
      encryptedTitle: crypto.encryptContent(input.title, 'memory_title', id),
      encryptedValue: crypto.encryptContent(input.value, 'memory_value', id),
      normalizedHash: crypto.blindTerm(normalized),
      topics: input.topics,
      sensitivity: input.sensitivity,
      visibility: input.visibility ?? 'share_with_authorized_clients',
      observedAt: input.observedAt ?? null,
      extractionMethod: input.extractionMethod,
      extractionModel: input.extractionModel ?? null,
      extractionPromptVersion: input.extractionPromptVersion ?? null,
      extractionSchemaVersion: input.extractionSchemaVersion ?? null,
      confidence: input.confidence ?? null,
      supersedesId: input.supersedesId ?? null,
      conflictGroupId: input.conflictGroupId ?? null,
    })
    .returning();
  if (!row) throw new Error('memory item insert returned no row');
  await replaceBlindTerms(tx, crypto, input.workspaceId, id, `${input.title} ${input.value}`);
  return decryptMemoryRow(crypto, row);
}

export async function replaceBlindTerms(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  workspaceId: Uuid,
  memoryItemId: Uuid,
  text: string,
): Promise<void> {
  await tx
    .delete(schema.memoryBlindTerms)
    .where(
      and(
        eq(schema.memoryBlindTerms.workspaceId, workspaceId),
        eq(schema.memoryBlindTerms.memoryItemId, memoryItemId),
      ),
    );
  const terms = [...new Set(normalizedTokens(text))];
  if (terms.length === 0) return;
  await tx
    .insert(schema.memoryBlindTerms)
    .values(
      terms.map((term) => ({
        workspaceId,
        memoryItemId,
        termHash: crypto.blindTerm(term),
      })),
    )
    .onConflictDoNothing();
}

export async function updateMemoryContent(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  workspaceId: Uuid,
  id: Uuid,
  patch: {
    title?: string;
    value?: string;
    topics?: string[];
    sensitivity?: SensitivityLevel;
    visibility?: ClientVisibilityPolicy;
  },
): Promise<void> {
  const current = await getMemoryItem(tx, crypto, workspaceId, id);
  if (!current) return;
  const title = patch.title ?? current.title;
  const value = patch.value ?? current.value;
  await tx
    .update(schema.memoryItems)
    .set({
      encryptedTitle: crypto.encryptContent(title, 'memory_title', id),
      encryptedValue: crypto.encryptContent(value, 'memory_value', id),
      normalizedHash: crypto.blindTerm(normalizeValue(value)),
      topics: patch.topics ?? current.topics,
      sensitivity: patch.sensitivity ?? current.sensitivity,
      visibility: patch.visibility ?? current.visibility,
      extractionMethod: 'user_edit',
      updatedAt: sql`now()`,
    })
    .where(and(eq(schema.memoryItems.workspaceId, workspaceId), eq(schema.memoryItems.id, id)));
  await replaceBlindTerms(tx, crypto, workspaceId, id, `${title} ${value}`);
}

export async function setMemoryStatus(
  tx: CairnTx,
  workspaceId: Uuid,
  id: Uuid,
  status: MemoryStatus,
  extra?: { supersededById?: Uuid | null; conflictGroupId?: Uuid | null },
): Promise<void> {
  await tx
    .update(schema.memoryItems)
    .set({
      status,
      supersededById: extra?.supersededById ?? undefined,
      conflictGroupId: extra?.conflictGroupId ?? undefined,
      updatedAt: sql`now()`,
    })
    .where(and(eq(schema.memoryItems.workspaceId, workspaceId), eq(schema.memoryItems.id, id)));
}

export async function setCanonicalLocation(
  tx: CairnTx,
  workspaceId: Uuid,
  ids: Uuid[],
  versionId: Uuid,
  pathByItem: Map<Uuid, string>,
): Promise<void> {
  for (const id of ids) {
    await tx
      .update(schema.memoryItems)
      .set({
        canonicalVersionId: versionId,
        canonicalPath: pathByItem.get(id) ?? null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(schema.memoryItems.workspaceId, workspaceId), eq(schema.memoryItems.id, id)));
  }
}

export async function getMemoryItem(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  workspaceId: Uuid,
  id: Uuid,
): Promise<MemoryItem | null> {
  const [row] = await tx
    .select()
    .from(schema.memoryItems)
    .where(
      and(
        eq(schema.memoryItems.workspaceId, workspaceId),
        eq(schema.memoryItems.id, id),
        isNull(schema.memoryItems.deletedAt),
      ),
    )
    .limit(1);
  return row ? decryptMemoryRow(crypto, row) : null;
}

export async function listMemoryItems(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  filter: {
    workspaceId: Uuid;
    projectId?: Uuid;
    statuses?: MemoryStatus[];
    types?: MemoryType[];
    limit?: number;
  },
): Promise<MemoryItem[]> {
  const conditions = [
    eq(schema.memoryItems.workspaceId, filter.workspaceId),
    isNull(schema.memoryItems.deletedAt),
  ];
  if (filter.projectId) conditions.push(eq(schema.memoryItems.projectId, filter.projectId));
  if (filter.statuses?.length) conditions.push(inArray(schema.memoryItems.status, filter.statuses));
  if (filter.types?.length) conditions.push(inArray(schema.memoryItems.type, filter.types));

  const rows = await tx
    .select()
    .from(schema.memoryItems)
    .where(and(...conditions))
    .orderBy(desc(schema.memoryItems.updatedAt), asc(schema.memoryItems.id))
    .limit(Math.min(filter.limit ?? 200, 1000));
  return rows.map((r) => decryptMemoryRow(crypto, r));
}

/** Duplicate detection. Matches on the keyed hash, never on plaintext. */
export async function findByNormalizedValue(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  workspaceId: Uuid,
  projectId: Uuid,
  value: string,
): Promise<MemoryItem[]> {
  const rows = await tx
    .select()
    .from(schema.memoryItems)
    .where(
      and(
        eq(schema.memoryItems.workspaceId, workspaceId),
        eq(schema.memoryItems.projectId, projectId),
        eq(schema.memoryItems.normalizedHash, crypto.blindTerm(normalizeValue(value))),
        isNull(schema.memoryItems.deletedAt),
      ),
    );
  return rows.map((r) => decryptMemoryRow(crypto, r));
}

export async function softDeleteMemoryItem(
  tx: CairnTx,
  workspaceId: Uuid,
  id: Uuid,
): Promise<void> {
  await tx
    .update(schema.memoryItems)
    .set({ deletedAt: sql`now()`, status: 'rejected', updatedAt: sql`now()` })
    .where(and(eq(schema.memoryItems.workspaceId, workspaceId), eq(schema.memoryItems.id, id)));
  // Derived data goes immediately; a removed memory must stop being findable now,
  // not at the next reindex.
  await tx
    .delete(schema.memoryItemEmbeddings)
    .where(
      and(
        eq(schema.memoryItemEmbeddings.workspaceId, workspaceId),
        eq(schema.memoryItemEmbeddings.memoryItemId, id),
      ),
    );
  await tx
    .delete(schema.memoryBlindTerms)
    .where(
      and(
        eq(schema.memoryBlindTerms.workspaceId, workspaceId),
        eq(schema.memoryBlindTerms.memoryItemId, id),
      ),
    );
}

/* ------------------------------- evidence -------------------------------- */

export interface NewEvidence {
  workspaceId: Uuid;
  memoryItemId: Uuid;
  sourceItemId: Uuid;
  sourceRevisionId: Uuid;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  locator?: string | null;
}

export async function addEvidence(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  input: NewEvidence,
): Promise<Uuid> {
  const id = randomUUID();
  await tx.insert(schema.memoryEvidence).values({
    id,
    workspaceId: input.workspaceId,
    memoryItemId: input.memoryItemId,
    sourceItemId: input.sourceItemId,
    sourceRevisionId: input.sourceRevisionId,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    encryptedExcerpt: crypto.encryptContent(input.excerpt, 'evidence_excerpt', id),
    locator: input.locator ?? null,
    contentHash: contentHash(input.excerpt),
  });
  return id;
}

export async function listEvidence(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  workspaceId: Uuid,
  memoryItemIds: Uuid[],
): Promise<Map<Uuid, MemoryEvidence[]>> {
  const out = new Map<Uuid, MemoryEvidence[]>();
  if (memoryItemIds.length === 0) return out;
  const rows = await tx
    .select()
    .from(schema.memoryEvidence)
    .where(
      and(
        eq(schema.memoryEvidence.workspaceId, workspaceId),
        inArray(schema.memoryEvidence.memoryItemId, memoryItemIds),
      ),
    )
    .orderBy(asc(schema.memoryEvidence.startOffset));
  for (const row of rows) {
    const list = out.get(row.memoryItemId) ?? [];
    list.push({
      id: row.id,
      workspaceId: row.workspaceId,
      memoryItemId: row.memoryItemId,
      sourceItemId: row.sourceItemId,
      sourceRevisionId: row.sourceRevisionId,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      excerpt: crypto.decryptContent(row.encryptedExcerpt, 'evidence_excerpt', row.id),
      locator: row.locator,
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    });
    out.set(row.memoryItemId, list);
  }
  return out;
}

export async function countEvidence(
  tx: CairnTx,
  workspaceId: Uuid,
  memoryItemId: Uuid,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memoryEvidence)
    .where(
      and(
        eq(schema.memoryEvidence.workspaceId, workspaceId),
        eq(schema.memoryEvidence.memoryItemId, memoryItemId),
      ),
    );
  return row?.n ?? 0;
}
