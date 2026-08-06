import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceCrypto } from '@cairn/crypto';
import { type CairnTx, memoryRepo, normalizeRows, schema, sourcesRepo } from '@cairn/db';
import {
  type ActorContext,
  type Citation,
  type Embedder,
  type MemoryType,
  type RetrievedPassage,
  type SensitivityLevel,
  type Uuid,
  disclosureBlockReason,
  normalizedTokens,
} from '@cairn/domain';

/**
 * Retrieval.
 *
 * The ordering of the steps is the security property, not an implementation
 * detail: authorization and sensitivity are applied in SQL, against plaintext
 * metadata columns, *before* any ciphertext is fetched or any key is used. A
 * memory the caller may not see is never decrypted, so it cannot leak through a
 * later bug in ranking, formatting, or answer generation.
 */

export interface SearchOptions {
  query: string;
  projectId?: Uuid;
  types?: MemoryType[];
  limit?: number;
  /** Widen the candidate pool before fusion; ranking quality vs. work done. */
  candidateFactor?: number;
}

export interface SearchDeps {
  tx: CairnTx;
  crypto: WorkspaceCrypto;
  embedder: Embedder;
}

interface Candidate {
  id: Uuid;
  projectId: Uuid;
  status: string;
  type: MemoryType;
  sensitivity: SensitivityLevel;
  visibility: string;
  semanticRank?: number;
  semanticScore?: number;
  exactRank?: number;
  exactHits?: number;
}

/** Reciprocal rank fusion. `k` damps the influence of any single ranker's tail. */
const RRF_K = 60;

export async function searchMemory(
  deps: SearchDeps,
  actor: ActorContext,
  options: SearchOptions,
): Promise<RetrievedPassage[]> {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);
  const poolSize = limit * (options.candidateFactor ?? 4);
  const query = options.query.trim();
  if (query.length === 0) return [];

  const candidates = new Map<Uuid, Candidate>();

  /* ---------------- semantic ---------------- */
  const { vectors } = await deps.embedder.embed([query]);
  const vectorLiteral = `[${vectors[0]!.join(',')}]`;
  const semantic = normalizeRows<{
    id: string;
    project_id: string;
    status: string;
    type: MemoryType;
    sensitivity: SensitivityLevel;
    visibility: string;
    score: number;
  }>(
    await deps.tx.execute(sql`
      SELECT m.id, m.project_id, m.status, m.type, m.sensitivity, m.visibility,
             1 - (e.embedding <=> ${vectorLiteral}::vector) AS score
      FROM memory_item_embeddings e
      JOIN memory_items m ON m.id = e.memory_item_id
      WHERE m.workspace_id = ${actor.workspaceId}
        AND m.status = 'approved'
        AND m.deleted_at IS NULL
        ${options.projectId ? sql`AND m.project_id = ${options.projectId}` : sql``}
        ${projectGrantClause(actor)}
        ${memoryTypeClause(actor)}
        ${sensitivityClause(actor)}
        ${visibilityClause(actor)}
      ORDER BY e.embedding <=> ${vectorLiteral}::vector
      LIMIT ${poolSize}
    `),
  );
  semantic.forEach((row, index) => {
    candidates.set(row.id, {
      id: row.id,
      projectId: row.project_id,
      status: row.status,
      type: row.type,
      sensitivity: row.sensitivity,
      visibility: row.visibility,
      semanticRank: index + 1,
      semanticScore: Number(row.score),
    });
  });

  /* ---------------- exact (blind index) ---------------- */
  const terms = [...new Set(normalizedTokens(query))];
  if (terms.length > 0) {
    const hashes = terms.map((t) => deps.crypto.blindTerm(t));
    const exact = normalizeRows<{
      id: string;
      project_id: string;
      status: string;
      type: MemoryType;
      sensitivity: SensitivityLevel;
      visibility: string;
      hits: number;
    }>(
      await deps.tx.execute(sql`
        SELECT m.id, m.project_id, m.status, m.type, m.sensitivity, m.visibility,
               count(*)::int AS hits
        FROM memory_blind_terms b
        JOIN memory_items m ON m.id = b.memory_item_id
        WHERE b.workspace_id = ${actor.workspaceId}
          AND b.term_hash IN (${sql.join(
            hashes.map((h) => sql`${h}`),
            sql`, `,
          )})
          AND m.status = 'approved'
          AND m.deleted_at IS NULL
          ${options.projectId ? sql`AND m.project_id = ${options.projectId}` : sql``}
          ${projectGrantClause(actor)}
          ${memoryTypeClause(actor)}
          ${sensitivityClause(actor)}
          ${visibilityClause(actor)}
        GROUP BY m.id, m.project_id, m.status, m.type, m.sensitivity, m.visibility
        ORDER BY hits DESC
        LIMIT ${poolSize}
      `),
    );
    exact.forEach((row, index) => {
      const existing = candidates.get(row.id);
      if (existing) {
        existing.exactRank = index + 1;
        existing.exactHits = Number(row.hits);
      } else {
        candidates.set(row.id, {
          id: row.id,
          projectId: row.project_id,
          status: row.status,
          type: row.type,
          sensitivity: row.sensitivity,
          visibility: row.visibility,
          exactRank: index + 1,
          exactHits: Number(row.hits),
        });
      }
    });
  }

  /* ---------------- fuse, re-check, then decrypt ---------------- */
  const ranked = [...candidates.values()]
    // Defence in depth: the SQL above already excluded these, and this line means
    // a mistake in that SQL still cannot disclose anything.
    .filter(
      (c) =>
        disclosureBlockReason(actor, {
          status: c.status as never,
          type: c.type,
          sensitivity: c.sensitivity,
          visibility: c.visibility as never,
          projectId: c.projectId,
        }) === null,
    )
    .map((c) => ({
      candidate: c,
      score:
        (c.semanticRank ? 1 / (RRF_K + c.semanticRank) : 0) +
        (c.exactRank ? 1.2 / (RRF_K + c.exactRank) : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (ranked.length === 0) return [];

  const ids = ranked.map((r) => r.candidate.id);
  const rows = await deps.tx
    .select()
    .from(schema.memoryItems)
    .where(
      and(
        eq(schema.memoryItems.workspaceId, actor.workspaceId),
        inArray(schema.memoryItems.id, ids),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, memoryRepo.decryptMemoryRow(deps.crypto, r)]));

  const evidenceByItem = await memoryRepo.listEvidence(
    deps.tx,
    deps.crypto,
    actor.workspaceId,
    ids,
  );
  const sourceItemIds = [...evidenceByItem.values()].flat().map((e) => e.sourceItemId);
  const revisionIds = [...evidenceByItem.values()].flat().map((e) => e.sourceRevisionId);
  const sourceItems = await sourcesRepo.getSourceItems(deps.tx, actor.workspaceId, [
    ...new Set(sourceItemIds),
  ]);
  const revisions = await sourcesRepo.getRevisions(deps.tx, actor.workspaceId, [
    ...new Set(revisionIds),
  ]);

  return ranked.flatMap(({ candidate, score }) => {
    const item = byId.get(candidate.id);
    if (!item) return [];
    const matchedBy: Array<'semantic' | 'exact'> = [];
    if (candidate.semanticRank) matchedBy.push('semantic');
    if (candidate.exactRank) matchedBy.push('exact');

    const citations: Citation[] = (evidenceByItem.get(item.id) ?? []).map((evidence) => {
      const source = sourceItems.get(evidence.sourceItemId);
      const revision = revisions.get(evidence.sourceRevisionId);
      return {
        memoryItemId: item.id,
        memoryVersionId: item.canonicalVersionId,
        canonicalPath: item.canonicalPath,
        sourceProvider: source?.provider ?? 'paste',
        sourceItemId: evidence.sourceItemId,
        sourceItemTitle: source?.title ?? 'Unknown source',
        sourceRevisionId: evidence.sourceRevisionId,
        locator: evidence.locator ?? source?.canonicalUri ?? null,
        excerpt: evidence.excerpt,
        startOffset: evidence.startOffset,
        endOffset: evidence.endOffset,
        importedAt: revision?.importedAt ?? evidence.createdAt,
      };
    });

    return [
      {
        memoryItem: {
          id: item.id,
          type: item.type,
          title: item.title,
          value: item.value,
          topics: item.topics,
          projectId: item.projectId,
          sensitivity: item.sensitivity,
          canonicalPath: item.canonicalPath,
          canonicalVersionId: item.canonicalVersionId,
          updatedAt: item.updatedAt,
        },
        score,
        matchedBy,
        citations,
      } satisfies RetrievedPassage,
    ];
  });
}

/* Filters expressed once, applied to every candidate query. */

function sensitivityClause(actor: ActorContext) {
  if (!actor.client) return sql``;
  const allowed =
    actor.client.maxSensitivity === 'restricted'
      ? ['normal', 'sensitive', 'restricted']
      : actor.client.maxSensitivity === 'sensitive'
        ? ['normal', 'sensitive']
        : ['normal'];
  return sql`AND m.sensitivity IN (${sql.join(
    allowed.map((a) => sql`${a}`),
    sql`, `,
  )})`;
}

function visibilityClause(actor: ActorContext) {
  if (!actor.client) return sql``;
  return sql`AND m.visibility = 'share_with_authorized_clients'`;
}

function projectGrantClause(actor: ActorContext) {
  if (!actor.client?.projectIds || actor.client.projectIds.length === 0) return sql``;
  return sql`AND m.project_id IN (${sql.join(
    actor.client.projectIds.map((p) => sql`${p}::uuid`),
    sql`, `,
  )})`;
}

/**
 * The per-type grant, applied in SQL before anything is decrypted — the same
 * rule `disclosureBlockReason` applies to a single item, expressed once here so
 * a scoped client's excluded types never even become candidates for ranking.
 */
function memoryTypeClause(actor: ActorContext) {
  if (!actor.client?.memoryTypes || actor.client.memoryTypes.length === 0) return sql``;
  return sql`AND m.type IN (${sql.join(
    actor.client.memoryTypes.map((t) => sql`${t}`),
    sql`, `,
  )})`;
}

/** Single-item read that applies exactly the same disclosure gate. */
export async function getDisclosableMemoryItem(
  deps: Omit<SearchDeps, 'embedder'>,
  actor: ActorContext,
  memoryItemId: Uuid,
): Promise<RetrievedPassage | null> {
  const [row] = await deps.tx
    .select()
    .from(schema.memoryItems)
    .where(
      and(
        eq(schema.memoryItems.workspaceId, actor.workspaceId),
        eq(schema.memoryItems.id, memoryItemId),
        isNull(schema.memoryItems.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (
    disclosureBlockReason(actor, {
      status: row.status as never,
      type: row.type as MemoryType,
      sensitivity: row.sensitivity as SensitivityLevel,
      visibility: row.visibility as never,
      projectId: row.projectId,
    }) !== null
  ) {
    return null;
  }

  const item = memoryRepo.decryptMemoryRow(deps.crypto, row);
  const evidence = (
    await memoryRepo.listEvidence(deps.tx, deps.crypto, actor.workspaceId, [item.id])
  ).get(item.id);
  const sourceItems = await sourcesRepo.getSourceItems(
    deps.tx,
    actor.workspaceId,
    (evidence ?? []).map((e) => e.sourceItemId),
  );
  const revisions = await sourcesRepo.getRevisions(
    deps.tx,
    actor.workspaceId,
    (evidence ?? []).map((e) => e.sourceRevisionId),
  );

  return {
    memoryItem: {
      id: item.id,
      type: item.type,
      title: item.title,
      value: item.value,
      topics: item.topics,
      projectId: item.projectId,
      sensitivity: item.sensitivity,
      canonicalPath: item.canonicalPath,
      canonicalVersionId: item.canonicalVersionId,
      updatedAt: item.updatedAt,
    },
    score: 1,
    matchedBy: ['exact'],
    citations: (evidence ?? []).map((e) => ({
      memoryItemId: item.id,
      memoryVersionId: item.canonicalVersionId,
      canonicalPath: item.canonicalPath,
      sourceProvider: sourceItems.get(e.sourceItemId)?.provider ?? 'paste',
      sourceItemId: e.sourceItemId,
      sourceItemTitle: sourceItems.get(e.sourceItemId)?.title ?? 'Unknown source',
      sourceRevisionId: e.sourceRevisionId,
      locator: e.locator,
      excerpt: e.excerpt,
      startOffset: e.startOffset,
      endOffset: e.endOffset,
      importedAt: revisions.get(e.sourceRevisionId)?.importedAt ?? e.createdAt,
    })),
  };
}
