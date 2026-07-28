import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { CONNECTOR_DESCRIPTIONS, connectorStatus } from '@cairn/connectors';
import {
  auditRepo,
  clientsRepo,
  jobsRepo,
  memoryRepo,
  schema,
  sourcesRepo,
  usageRepo,
  withTenant,
} from '@cairn/db';
import {
  type Answer,
  type AuditEvent,
  type Citation,
  type Job,
  type McpClient,
  type MemoryEvidence,
  type MemoryItem,
  type MemoryType,
  type RetrievedPassage,
  type SourceConnection,
  type SourceItem,
  type SourceProvider,
  type VaultVersion,
  CANONICAL_DOCS,
} from '@cairn/domain';
import { searchMemory } from '@cairn/search';
import { PostgresMemoryVault } from '@cairn/vault';
import type { RequestContext } from './context';

/**
 * Read models for the pages.
 *
 * Pages get finished view objects rather than a database handle, which keeps the
 * decryption and authorization in one place and the components free of data
 * plumbing.
 */

export interface MemoryCardView {
  item: MemoryItem;
  evidence: MemoryEvidence[];
  sources: Map<string, SourceItem>;
  conflict: { id: string; reason: string; otherIds: string[] } | null;
}

async function loadCards(
  context: RequestContext,
  filter: { projectId: string; statuses: MemoryItem['status'][]; limit?: number },
): Promise<MemoryCardView[]> {
  const crypto = await context.services.keyring.get(context.actor.workspaceId);
  return withTenant(context.services.handle, context.actor, async (tx) => {
    const items = await memoryRepo.listMemoryItems(tx, crypto, {
      workspaceId: context.actor.workspaceId,
      projectId: filter.projectId,
      statuses: filter.statuses,
      limit: filter.limit ?? 200,
    });
    if (items.length === 0) return [];

    const evidence = await memoryRepo.listEvidence(
      tx,
      crypto,
      context.actor.workspaceId,
      items.map((i) => i.id),
    );
    const sources = await sourcesRepo.getSourceItems(tx, context.actor.workspaceId, [
      ...new Set([...evidence.values()].flat().map((e) => e.sourceItemId)),
    ]);
    const conflicts = await tx
      .select()
      .from(schema.memoryConflicts)
      .where(
        and(
          eq(schema.memoryConflicts.workspaceId, context.actor.workspaceId),
          eq(schema.memoryConflicts.projectId, filter.projectId),
          eq(schema.memoryConflicts.status, 'open'),
        ),
      );

    return items.map((item) => {
      const conflict = conflicts.find((c) => c.memoryItemIds.includes(item.id));
      return {
        item,
        evidence: evidence.get(item.id) ?? [],
        sources,
        conflict: conflict
          ? {
              id: conflict.id,
              reason: conflict.reason,
              otherIds: conflict.memoryItemIds.filter((id) => id !== item.id),
            }
          : null,
      };
    });
  });
}

export interface OverviewView {
  proposals: MemoryCardView[];
  /**
   * What the person decided in the last couple of minutes.
   *
   * Keeping or removing a memory takes it out of the review list, which takes the
   * confirmation with it. Surfacing the decision separately means the action is
   * acknowledged where they are looking, and undo stays one click away.
   */
  recentlyDecided: { kept: MemoryItem[]; removed: MemoryItem[] };
  approvedByType: Array<{ type: MemoryType; label: string; count: number; samples: string[] }>;
  approvedCount: number;
  sourceCount: number;
  latestVersion: VaultVersion | null;
  runningJobs: number;
  failedJobs: number;
  conflictCount: number;
}

const RECENT_DECISION_WINDOW_MS = 2 * 60_000;

export async function loadOverview(context: RequestContext): Promise<OverviewView> {
  const projectId = context.project.id;
  const [proposals, approved] = await Promise.all([
    loadCards(context, { projectId, statuses: ['proposed'], limit: 60 }),
    loadCards(context, { projectId, statuses: ['approved'], limit: 300 }),
  ]);

  const byType = new Map<MemoryType, MemoryItem[]>();
  for (const card of approved) {
    const list = byType.get(card.item.type) ?? [];
    list.push(card.item);
    byType.set(card.item.type, list);
  }

  const vault = context.services.vault as PostgresMemoryVault;
  const [latestVersion, counts] = await Promise.all([
    vault.head({ actor: context.actor, projectId }),
    withTenant(context.services.handle, context.actor, async (tx) => {
      const [sources] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.sourceItems)
        .where(
          and(
            eq(schema.sourceItems.workspaceId, context.actor.workspaceId),
            eq(schema.sourceItems.projectId, projectId),
          ),
        );
      const jobs = await jobsRepo.listJobs(tx, context.actor.workspaceId, {
        projectId,
        limit: 100,
      });
      const [conflicts] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.memoryConflicts)
        .where(
          and(
            eq(schema.memoryConflicts.workspaceId, context.actor.workspaceId),
            eq(schema.memoryConflicts.status, 'open'),
          ),
        );
      return {
        sourceCount: sources?.n ?? 0,
        runningJobs: jobs.filter((j) => j.state === 'queued' || j.state === 'running').length,
        failedJobs: jobs.filter((j) => j.state === 'dead').length,
        conflictCount: conflicts?.n ?? 0,
      };
    }),
  ]);

  const since = Date.now() - RECENT_DECISION_WINDOW_MS;
  const crypto = await context.services.keyring.get(context.actor.workspaceId);
  const removed = await withTenant(context.services.handle, context.actor, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.memoryItems)
      .where(
        and(
          eq(schema.memoryItems.workspaceId, context.actor.workspaceId),
          eq(schema.memoryItems.projectId, projectId),
          isNotNull(schema.memoryItems.deletedAt),
        ),
      )
      .orderBy(desc(schema.memoryItems.updatedAt))
      .limit(5);
    return rows
      .filter((r) => r.updatedAt.getTime() >= since)
      .map((r) => memoryRepo.decryptMemoryRow(crypto, r));
  });

  return {
    proposals,
    recentlyDecided: {
      kept: approved.map((c) => c.item).filter((i) => i.updatedAt.getTime() >= since),
      removed,
    },
    approvedByType: [...byType.entries()]
      .map(([type, items]) => ({
        type,
        label: CANONICAL_DOCS[type].title,
        count: items.length,
        samples: items.slice(0, 3).map((i) => i.title),
      }))
      .sort((a, b) => b.count - a.count),
    approvedCount: approved.length,
    ...counts,
    latestVersion,
  };
}

export async function loadMemoryPage(
  context: RequestContext,
  filter: 'all' | 'proposed' | 'approved' | 'conflicted',
): Promise<{ cards: MemoryCardView[]; counts: Record<string, number> }> {
  const projectId = context.project.id;
  const statuses =
    filter === 'proposed'
      ? (['proposed'] as const)
      : filter === 'approved'
        ? (['approved'] as const)
        : filter === 'conflicted'
          ? (['conflicted'] as const)
          : (['proposed', 'approved', 'conflicted'] as const);

  const [cards, all] = await Promise.all([
    loadCards(context, { projectId, statuses: [...statuses] }),
    loadCards(context, { projectId, statuses: ['proposed', 'approved', 'conflicted'] }),
  ]);
  return {
    cards,
    counts: {
      all: all.length,
      proposed: all.filter((c) => c.item.status === 'proposed').length,
      approved: all.filter((c) => c.item.status === 'approved').length,
      conflicted: all.filter((c) => c.item.status === 'conflicted').length,
    },
  };
}

export interface SourcesView {
  connections: SourceConnection[];
  items: SourceItem[];
  jobs: Job[];
  available: Array<{
    provider: SourceProvider;
    status: 'ready' | 'demo' | 'setup-required';
    description: (typeof CONNECTOR_DESCRIPTIONS)[SourceProvider];
  }>;
}

export async function loadSources(context: RequestContext): Promise<SourcesView> {
  return withTenant(context.services.handle, context.actor, async (tx) => {
    const [connections, items, jobs] = await Promise.all([
      sourcesRepo.listConnections(tx, context.actor.workspaceId, context.project.id),
      sourcesRepo.listSourceItems(tx, context.actor.workspaceId, context.project.id, 60),
      jobsRepo.listJobs(tx, context.actor.workspaceId, {
        projectId: context.project.id,
        limit: 25,
      }),
    ]);
    return {
      connections,
      items,
      jobs,
      available: (['google_drive', 'github'] as const).map((provider) => ({
        provider,
        status: connectorStatus(provider, context.services.config),
        description: CONNECTOR_DESCRIPTIONS[provider],
      })),
    };
  });
}

export interface AskView {
  answer: Answer;
  passages: RetrievedPassage[];
  usedModel: string;
}

export async function askQuestion(context: RequestContext, question: string): Promise<AskView> {
  const crypto = await context.services.keyring.get(context.actor.workspaceId);
  const passages = await withTenant(context.services.handle, context.actor, (tx) =>
    searchMemory({ tx, crypto, embedder: context.services.embedder }, context.actor, {
      query: question,
      projectId: context.project.id,
      limit: 8,
    }),
  );
  const { answer, usage } = await context.services.answerer.answer({ question, passages });

  if (usage.estimatedCostUsd > 0) {
    await withTenant(context.services.handle, context.actor, (tx) =>
      usageRepo.recordModelUsage(tx, {
        workspaceId: context.actor.workspaceId,
        projectId: context.project.id,
        operation: 'answer',
        provider: context.services.answerer.kind,
        model: context.services.answerer.modelLabel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
        cached: false,
      }),
    );
  }
  return { answer, passages, usedModel: context.services.answerer.modelLabel };
}

export interface HistoryView {
  versions: VaultVersion[];
  events: AuditEvent[];
  removed: MemoryItem[];
}

export async function loadHistory(context: RequestContext): Promise<HistoryView> {
  const vault = context.services.vault as PostgresMemoryVault;
  const crypto = await context.services.keyring.get(context.actor.workspaceId);
  const [versions, rest] = await Promise.all([
    vault.history({ actor: context.actor, projectId: context.project.id, limit: 40 }),
    withTenant(context.services.handle, context.actor, async (tx) => {
      const events = await auditRepo.listAuditEvents(tx, context.actor.workspaceId, { limit: 60 });
      const removedRows = await tx
        .select()
        .from(schema.memoryItems)
        .where(
          and(
            eq(schema.memoryItems.workspaceId, context.actor.workspaceId),
            eq(schema.memoryItems.projectId, context.project.id),
            isNotNull(schema.memoryItems.deletedAt),
          ),
        )
        .orderBy(desc(schema.memoryItems.updatedAt))
        .limit(20);
      return {
        events,
        removed: removedRows.map((r) => memoryRepo.decryptMemoryRow(crypto, r)),
      };
    }),
  ]);
  return { versions, ...rest };
}

export async function loadVersionDocuments(
  context: RequestContext,
  versionId: string,
): Promise<{ version: VaultVersion | null; files: Array<{ path: string; content: string }> }> {
  const vault = context.services.vault as PostgresMemoryVault;
  return vault.readAll({ actor: context.actor, projectId: context.project.id, versionId });
}

export interface ConnectionsView {
  clients: McpClient[];
  mcpUrl: string;
  authMode: 'local' | 'oauth';
}

export async function loadConnections(context: RequestContext): Promise<ConnectionsView> {
  const clients = await withTenant(context.services.handle, context.actor, (tx) =>
    clientsRepo.listMcpClients(tx, context.actor.workspaceId),
  );
  return {
    clients,
    mcpUrl: `${context.services.config.appUrl}/api/mcp`,
    authMode: context.services.config.env.MCP_AUTH_MODE,
  };
}

export interface SettingsView {
  settings: Awaited<ReturnType<typeof usageRepo.getSettings>>;
  budget: Awaited<ReturnType<typeof usageRepo.checkBudget>>;
  usage: Array<{ operation: string; model: string; calls: number; costUsd: number }>;
  backups: Array<{
    id: string;
    createdAt: Date;
    byteSize: number;
    contentHash: string;
    note: string | null;
  }>;
  memoryCount: number;
  sourceCount: number;
}

export async function loadSettings(context: RequestContext): Promise<SettingsView> {
  return withTenant(context.services.handle, context.actor, async (tx) => {
    const defaults = { budgetUsd: context.services.config.env.CAIRN_AI_MONTHLY_BUDGET_USD };
    const [settings, budget] = await Promise.all([
      usageRepo.getSettings(tx, context.actor.workspaceId, defaults),
      usageRepo.checkBudget(tx, context.actor.workspaceId, {
        defaultBudgetUsd: defaults.budgetUsd,
        softRatio: context.services.config.env.CAIRN_AI_SOFT_LIMIT_RATIO,
      }),
    ]);

    const usageRows = await tx
      .select({
        operation: schema.modelUsage.operation,
        model: schema.modelUsage.model,
        calls: sql<number>`count(*)::int`,
        costUsd: sql<string>`coalesce(sum(estimated_cost_usd),0)::text`,
      })
      .from(schema.modelUsage)
      .where(eq(schema.modelUsage.workspaceId, context.actor.workspaceId))
      .groupBy(schema.modelUsage.operation, schema.modelUsage.model);

    const backupRows = await tx
      .select()
      .from(schema.backups)
      .where(eq(schema.backups.workspaceId, context.actor.workspaceId))
      .orderBy(desc(schema.backups.createdAt))
      .limit(10);

    const [memory] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.memoryItems)
      .where(
        and(
          eq(schema.memoryItems.workspaceId, context.actor.workspaceId),
          eq(schema.memoryItems.status, 'approved'),
        ),
      );
    const [sources] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.sourceItems)
      .where(eq(schema.sourceItems.workspaceId, context.actor.workspaceId));

    return {
      settings,
      budget,
      usage: usageRows.map((r) => ({
        operation: r.operation,
        model: r.model,
        calls: Number(r.calls),
        costUsd: Number(r.costUsd),
      })),
      backups: backupRows.map((b) => ({
        id: b.id,
        createdAt: b.createdAt,
        byteSize: b.byteSize,
        contentHash: b.contentHash,
        note: b.note,
      })),
      memoryCount: memory?.n ?? 0,
      sourceCount: sources?.n ?? 0,
    };
  });
}

/** Turns evidence into the shape the citation UI renders. */
export function toCitations(card: MemoryCardView): Citation[] {
  return card.evidence.map((e) => ({
    memoryItemId: card.item.id,
    memoryVersionId: card.item.canonicalVersionId,
    canonicalPath: card.item.canonicalPath,
    sourceProvider: card.sources.get(e.sourceItemId)?.provider ?? 'paste',
    sourceItemId: e.sourceItemId,
    sourceItemTitle: card.sources.get(e.sourceItemId)?.title ?? 'Unknown source',
    sourceRevisionId: e.sourceRevisionId,
    locator: e.locator ?? card.sources.get(e.sourceItemId)?.canonicalUri ?? null,
    excerpt: e.excerpt,
    startOffset: e.startOffset,
    endOffset: e.endOffset,
    importedAt: e.createdAt,
  }));
}

export { inArray };
