import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Uuid } from '@cairn/domain';
import type { CairnTx, DbHandle } from '../client';
import * as schema from '../schema';
import { normalizeRows } from '../rows';
import { withSystem } from '../tenancy';

/**
 * Deletion, done honestly.
 *
 * Every table that can hold a trace of the user's content is listed here, and the
 * report says how many rows each one lost. If a category cannot be removed
 * (because an external provider holds it), that belongs in the report too rather
 * than in a footnote — see `externalRemainders`.
 */

export interface DeletionReport {
  scope: 'workspace' | 'project' | 'connection';
  removed: Record<string, number>;
  externalRemainders: string[];
}

export async function requestDeletion(
  tx: CairnTx,
  input: {
    workspaceId: Uuid;
    requestedBy: Uuid | null;
    scope: 'workspace' | 'project' | 'connection' | 'memory_item';
    targetId?: Uuid | null;
    details?: Record<string, unknown>;
  },
): Promise<Uuid> {
  const id = randomUUID();
  await tx.insert(schema.deletionRequests).values({
    id,
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
    scope: input.scope,
    targetId: input.targetId ?? null,
    details: input.details ?? {},
  });
  return id;
}

export async function completeDeletionRequest(
  tx: CairnTx,
  workspaceId: Uuid,
  id: Uuid,
  report: DeletionReport,
): Promise<void> {
  await tx
    .update(schema.deletionRequests)
    .set({
      state: 'completed',
      completedAt: sql`now()`,
      details: report as unknown as Record<string, unknown>,
    })
    .where(
      and(eq(schema.deletionRequests.workspaceId, workspaceId), eq(schema.deletionRequests.id, id)),
    );
}

/**
 * Removes a project's content while keeping the workspace and its audit history.
 *
 * Runs on the system path: this deliberately reaches across every derived table,
 * and doing it under RLS would silently skip anything whose policy the caller does
 * not satisfy.
 */
export async function deleteProjectContent(
  handle: DbHandle,
  workspaceId: Uuid,
  projectId: Uuid,
): Promise<DeletionReport> {
  return withSystem(handle, async (tx) => {
    const removed: Record<string, number> = {};
    const count = async (label: string, run: Promise<{ length: number }>) => {
      removed[label] = (await run).length;
    };

    await count(
      'search index entries',
      tx
        .delete(schema.memoryItemEmbeddings)
        .where(
          and(
            eq(schema.memoryItemEmbeddings.workspaceId, workspaceId),
            eq(schema.memoryItemEmbeddings.projectId, projectId),
          ),
        )
        .returning({ id: schema.memoryItemEmbeddings.memoryItemId }),
    );
    await count(
      'chunks',
      tx
        .delete(schema.chunks)
        .where(
          and(eq(schema.chunks.workspaceId, workspaceId), eq(schema.chunks.projectId, projectId)),
        )
        .returning({ id: schema.chunks.id }),
    );
    await count(
      'saved memories',
      tx
        .delete(schema.memoryItems)
        .where(
          and(
            eq(schema.memoryItems.workspaceId, workspaceId),
            eq(schema.memoryItems.projectId, projectId),
          ),
        )
        .returning({ id: schema.memoryItems.id }),
    );
    await count(
      'imported documents',
      tx
        .delete(schema.sourceItems)
        .where(
          and(
            eq(schema.sourceItems.workspaceId, workspaceId),
            eq(schema.sourceItems.projectId, projectId),
          ),
        )
        .returning({ id: schema.sourceItems.id }),
    );
    await count(
      'memory versions',
      tx
        .delete(schema.vaultVersions)
        .where(
          and(
            eq(schema.vaultVersions.workspaceId, workspaceId),
            eq(schema.vaultVersions.projectId, projectId),
          ),
        )
        .returning({ id: schema.vaultVersions.id }),
    );
    await count(
      'connections',
      tx
        .delete(schema.sourceConnections)
        .where(
          and(
            eq(schema.sourceConnections.workspaceId, workspaceId),
            eq(schema.sourceConnections.projectId, projectId),
          ),
        )
        .returning({ id: schema.sourceConnections.id }),
    );
    await count(
      'background jobs',
      tx
        .delete(schema.jobs)
        .where(and(eq(schema.jobs.workspaceId, workspaceId), eq(schema.jobs.projectId, projectId)))
        .returning({ id: schema.jobs.id }),
    );
    await count(
      'backups',
      tx
        .delete(schema.backups)
        .where(
          and(eq(schema.backups.workspaceId, workspaceId), eq(schema.backups.projectId, projectId)),
        )
        .returning({ id: schema.backups.id }),
    );

    // Vault objects are shared by content hash across a workspace's projects, so
    // only orphans may go.
    const orphaned = await tx.execute(sql`
      DELETE FROM vault_objects vo
      WHERE vo.workspace_id = ${workspaceId}
        AND NOT EXISTS (
          SELECT 1 FROM vault_versions vv, jsonb_array_elements(vv.manifest -> 'entries') e
          WHERE vv.workspace_id = ${workspaceId} AND e ->> 'contentHash' = vo.content_hash
        )
      RETURNING vo.content_hash
    `);
    removed['stored documents'] = normalizeRows(orphaned).length;

    await tx
      .update(schema.projects)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(schema.projects.workspaceId, workspaceId), eq(schema.projects.id, projectId)));

    return {
      scope: 'project',
      removed,
      externalRemainders: [
        'Copies you exported or downloaded yourself are not affected.',
        'Anything an AI tool already saved into its own history stays with that tool.',
      ],
    };
  });
}

/**
 * Removes the workspace and everything in it.
 *
 * Ordering matters only for the key: it goes last, so a failure part-way through
 * still leaves the remaining ciphertext decryptable by a retry.
 */
export async function deleteWorkspace(
  handle: DbHandle,
  workspaceId: Uuid,
): Promise<DeletionReport> {
  return withSystem(handle, async (tx) => {
    const removed: Record<string, number> = {};

    const projects = await tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.workspaceId, workspaceId));
    removed['projects'] = projects.length;

    for (const [label, table, column] of [
      ['stored files', schema.storedObjects, schema.storedObjects.workspaceId],
      ['stored documents', schema.vaultObjects, schema.vaultObjects.workspaceId],
      ['backups', schema.backups, schema.backups.workspaceId],
      ['connected AIs', schema.mcpClients, schema.mcpClients.workspaceId],
      ['audit history', schema.auditEvents, schema.auditEvents.workspaceId],
      ['AI usage records', schema.modelUsage, schema.modelUsage.workspaceId],
    ] as const) {
      const rows = await tx.delete(table).where(eq(column, workspaceId)).returning({ w: column });
      removed[label] = rows.length;
    }

    // Cascades handle memory, sources, chunks, versions and jobs via foreign keys.
    await tx.delete(schema.workspaceKeys).where(eq(schema.workspaceKeys.workspaceId, workspaceId));
    await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    removed['workspace'] = 1;

    return {
      scope: 'workspace',
      removed,
      externalRemainders: [
        'The key that could decrypt this workspace has been destroyed, so any leftover encrypted bytes in backups become unreadable.',
        'Copies you exported or downloaded yourself are not affected.',
        'Anything an AI tool already saved into its own history stays with that tool.',
      ],
    };
  });
}
