import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { BudgetExceededError, type Uuid } from '@cairn/domain';
import type { CairnTx } from '../client';
import * as schema from '../schema';

/**
 * Spend control for metered AI work.
 *
 * Every model call is recorded with its token counts and estimated cost, and the
 * budget is checked *before* the call. A workspace that reaches its hard limit
 * stops spending money rather than discovering the bill later.
 */

export interface WorkspaceSettings {
  workspaceId: Uuid;
  aiMonthlyBudgetUsd: number;
  aiHardLimitEnabled: boolean;
  privacyMode: boolean;
  retentionDaysRaw: number;
}

export async function getSettings(
  tx: CairnTx,
  workspaceId: Uuid,
  defaults: { budgetUsd: number },
): Promise<WorkspaceSettings> {
  const [row] = await tx
    .select()
    .from(schema.workspaceSettings)
    .where(eq(schema.workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  if (!row) {
    return {
      workspaceId,
      aiMonthlyBudgetUsd: defaults.budgetUsd,
      aiHardLimitEnabled: true,
      privacyMode: false,
      retentionDaysRaw: 365,
    };
  }
  return {
    workspaceId,
    aiMonthlyBudgetUsd: Number(row.aiMonthlyBudgetUsd),
    aiHardLimitEnabled: row.aiHardLimitEnabled,
    privacyMode: row.privacyMode,
    retentionDaysRaw: row.retentionDaysRaw,
  };
}

export async function saveSettings(
  tx: CairnTx,
  workspaceId: Uuid,
  patch: Partial<Omit<WorkspaceSettings, 'workspaceId'>>,
): Promise<void> {
  await tx
    .insert(schema.workspaceSettings)
    .values({
      workspaceId,
      aiMonthlyBudgetUsd: String(patch.aiMonthlyBudgetUsd ?? 5),
      aiHardLimitEnabled: patch.aiHardLimitEnabled ?? true,
      privacyMode: patch.privacyMode ?? false,
      retentionDaysRaw: patch.retentionDaysRaw ?? 365,
    })
    .onConflictDoUpdate({
      target: schema.workspaceSettings.workspaceId,
      set: {
        aiMonthlyBudgetUsd:
          patch.aiMonthlyBudgetUsd === undefined ? undefined : String(patch.aiMonthlyBudgetUsd),
        aiHardLimitEnabled: patch.aiHardLimitEnabled,
        privacyMode: patch.privacyMode,
        retentionDaysRaw: patch.retentionDaysRaw,
        updatedAt: sql`now()`,
      },
    });
}

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function monthToDateSpendUsd(
  tx: CairnTx,
  workspaceId: Uuid,
  now = new Date(),
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(estimated_cost_usd), 0)::text` })
    .from(schema.modelUsage)
    .where(
      and(
        eq(schema.modelUsage.workspaceId, workspaceId),
        gte(schema.modelUsage.createdAt, monthStart(now)),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function recordModelUsage(
  tx: CairnTx,
  input: {
    workspaceId: Uuid;
    projectId?: Uuid | null;
    jobId?: Uuid | null;
    operation: 'extraction' | 'embedding' | 'answer';
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    cached: boolean;
  },
): Promise<void> {
  await tx.insert(schema.modelUsage).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    jobId: input.jobId ?? null,
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedCostUsd: input.estimatedCostUsd.toFixed(6),
    cached: input.cached,
  });
}

export interface BudgetStatus {
  spentUsd: number;
  budgetUsd: number;
  ratio: number;
  overSoftLimit: boolean;
  blocked: boolean;
}

export async function checkBudget(
  tx: CairnTx,
  workspaceId: Uuid,
  options: { defaultBudgetUsd: number; softRatio: number; now?: Date },
): Promise<BudgetStatus> {
  const settings = await getSettings(tx, workspaceId, { budgetUsd: options.defaultBudgetUsd });
  const spentUsd = await monthToDateSpendUsd(tx, workspaceId, options.now);
  const budgetUsd = settings.aiMonthlyBudgetUsd;
  const ratio = budgetUsd > 0 ? spentUsd / budgetUsd : 0;
  return {
    spentUsd,
    budgetUsd,
    ratio,
    overSoftLimit: ratio >= options.softRatio,
    blocked: settings.aiHardLimitEnabled && budgetUsd > 0 && spentUsd >= budgetUsd,
  };
}

export async function assertWithinBudget(
  tx: CairnTx,
  workspaceId: Uuid,
  options: { defaultBudgetUsd: number; softRatio: number; now?: Date },
): Promise<BudgetStatus> {
  const status = await checkBudget(tx, workspaceId, options);
  if (status.blocked) {
    throw new BudgetExceededError(
      `Workspace ${workspaceId} has spent $${status.spentUsd.toFixed(4)} of its $${status.budgetUsd.toFixed(2)} monthly budget`,
    );
  }
  return status;
}
