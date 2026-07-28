import { and, eq, inArray } from 'drizzle-orm';
import type { WorkspaceCrypto } from '@cairn/crypto';
import { type CairnTx, schema, memoryRepo } from '@cairn/db';
import type { Embedder, MemoryItem, Uuid } from '@cairn/domain';

/**
 * Derived search data.
 *
 * Everything written here can be thrown away and rebuilt from the canonical
 * Markdown; nothing in this module is a source of truth. That is deliberate — it
 * means a bad embedding model, a schema change, or a corrupted index is a
 * reindex, not a data loss.
 */

export async function indexMemoryItems(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  embedder: Embedder,
  items: MemoryItem[],
): Promise<{ indexed: number; inputTokens: number; estimatedCostUsd: number; cached: boolean }> {
  if (items.length === 0) {
    return { indexed: 0, inputTokens: 0, estimatedCostUsd: 0, cached: true };
  }
  const texts = items.map((item) => `${item.title}\n\n${item.value}`);
  const { vectors, usage } = await embedder.embed(texts);

  for (const [i, item] of items.entries()) {
    await tx
      .insert(schema.memoryItemEmbeddings)
      .values({
        memoryItemId: item.id,
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        embedding: vectors[i]!,
        model: embedder.modelLabel,
      })
      .onConflictDoUpdate({
        target: [schema.memoryItemEmbeddings.workspaceId, schema.memoryItemEmbeddings.memoryItemId],
        set: { embedding: vectors[i]!, model: embedder.modelLabel },
      });
    await memoryRepo.replaceBlindTerms(
      tx,
      crypto,
      item.workspaceId,
      item.id,
      `${item.title} ${item.value}`,
    );
  }
  return {
    indexed: items.length,
    inputTokens: usage.inputTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
    cached: usage.cached,
  };
}

export async function removeFromIndex(
  tx: CairnTx,
  workspaceId: Uuid,
  memoryItemIds: Uuid[],
): Promise<void> {
  if (memoryItemIds.length === 0) return;
  await tx
    .delete(schema.memoryItemEmbeddings)
    .where(
      and(
        eq(schema.memoryItemEmbeddings.workspaceId, workspaceId),
        inArray(schema.memoryItemEmbeddings.memoryItemId, memoryItemIds),
      ),
    );
  await tx
    .delete(schema.memoryBlindTerms)
    .where(
      and(
        eq(schema.memoryBlindTerms.workspaceId, workspaceId),
        inArray(schema.memoryBlindTerms.memoryItemId, memoryItemIds),
      ),
    );
}

/**
 * Rebuilds the whole index for a project from what is currently approved.
 *
 * The test that matters here is not that this runs, but that running it after
 * dropping every derived row reproduces the same search results — that is the
 * property that makes the index disposable.
 */
export async function rebuildProjectIndex(
  tx: CairnTx,
  crypto: WorkspaceCrypto,
  embedder: Embedder,
  workspaceId: Uuid,
  projectId: Uuid,
): Promise<{ indexed: number }> {
  const items = await memoryRepo.listMemoryItems(tx, crypto, {
    workspaceId,
    projectId,
    statuses: ['approved'],
    limit: 1000,
  });
  await tx
    .delete(schema.memoryItemEmbeddings)
    .where(
      and(
        eq(schema.memoryItemEmbeddings.workspaceId, workspaceId),
        eq(schema.memoryItemEmbeddings.projectId, projectId),
      ),
    );
  const result = await indexMemoryItems(tx, crypto, embedder, items);
  return { indexed: result.indexed };
}
