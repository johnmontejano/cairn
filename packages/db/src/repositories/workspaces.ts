import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { MemberRole, Project, Uuid, User, Workspace } from '@cairn/domain';
import { NotFoundError, ForbiddenError } from '@cairn/domain';
import type { CairnTx, DbHandle } from '../client';
import type { Keyring } from '../keyring';
import * as schema from '../schema';
import { withSystem } from '../tenancy';

export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'project';
}

/**
 * Creates a person's first workspace, project, and data key in one transaction.
 *
 * Runs on the system path because there is no workspace to scope to until this
 * finishes. Everything afterwards goes through `withTenant`.
 */
export async function provisionUser(
  handle: DbHandle,
  keyring: Keyring,
  input: {
    email: string;
    displayName?: string | null;
    externalId?: string | null;
    authProvider: string;
  },
): Promise<{ user: User; workspace: Workspace; project: Project; created: boolean }> {
  return withSystem(handle, async (tx) => {
    const existing = await tx
      .select()
      .from(schema.users)
      .where(eq(sql`lower(${schema.users.email})`, input.email.toLowerCase()))
      .limit(1);

    if (existing[0]) {
      const user = toUser(existing[0]);
      const [membership] = await tx
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.userId, user.id))
        .limit(1);
      if (!membership) throw new NotFoundError('workspace for existing user');
      const [ws] = await tx
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, membership.workspaceId))
        .limit(1);
      const [proj] = await tx
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.workspaceId, membership.workspaceId))
        .limit(1);
      if (!ws || !proj) throw new NotFoundError('workspace');
      return { user, workspace: toWorkspace(ws), project: toProject(proj), created: false };
    }

    const userId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const label = input.displayName ?? input.email.split('@')[0] ?? 'You';

    const [userRow] = await tx
      .insert(schema.users)
      .values({
        id: userId,
        email: input.email,
        displayName: input.displayName ?? null,
        externalId: input.externalId ?? null,
        authProvider: input.authProvider,
      })
      .returning();
    const [wsRow] = await tx
      .insert(schema.workspaces)
      .values({ id: workspaceId, name: `${label}'s memory`, ownerUserId: userId })
      .returning();
    await tx
      .insert(schema.memberships)
      .values({ workspaceId, userId, role: 'owner' satisfies MemberRole });
    const [projRow] = await tx
      .insert(schema.projects)
      .values({
        id: projectId,
        workspaceId,
        name: 'My project',
        slug: 'my-project',
        description: 'Everything you want your AI tools to remember.',
      })
      .returning();
    await tx.insert(schema.workspaceSettings).values({ workspaceId }).onConflictDoNothing();
    await keyring.create(tx, workspaceId);

    if (!userRow || !wsRow || !projRow) throw new Error('provisioning returned no rows');
    return {
      user: toUser(userRow),
      workspace: toWorkspace(wsRow),
      project: toProject(projRow),
      created: true,
    };
  });
}

export async function resolveMembership(
  handle: DbHandle,
  userId: Uuid,
  workspaceId: Uuid,
): Promise<MemberRole> {
  const role = await withSystem(handle, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, workspaceId)),
      )
      .limit(1);
    return row?.role as MemberRole | undefined;
  });
  if (!role) throw new ForbiddenError('Not a member of that workspace');
  return role;
}

export async function listProjects(tx: CairnTx, workspaceId: Uuid): Promise<Project[]> {
  const rows = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, workspaceId))
    .orderBy(schema.projects.createdAt);
  return rows.filter((r) => !r.deletedAt).map(toProject);
}

export async function getProject(
  tx: CairnTx,
  workspaceId: Uuid,
  projectId: Uuid,
): Promise<Project | null> {
  const [row] = await tx
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.workspaceId, workspaceId), eq(schema.projects.id, projectId)))
    .limit(1);
  return row ? toProject(row) : null;
}

export async function createProject(
  tx: CairnTx,
  workspaceId: Uuid,
  input: { name: string; description?: string | null },
): Promise<Project> {
  const [row] = await tx
    .insert(schema.projects)
    .values({
      id: randomUUID(),
      workspaceId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? null,
    })
    .returning();
  if (!row) throw new Error('project insert returned no row');
  return toProject(row);
}

export async function getWorkspace(tx: CairnTx, workspaceId: Uuid): Promise<Workspace | null> {
  const [row] = await tx
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row ? toWorkspace(row) : null;
}

export function toUser(row: typeof schema.users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
  };
}

export function toWorkspace(row: typeof schema.workspaces.$inferSelect): Workspace {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
  };
}

export function toProject(row: typeof schema.projects.$inferSelect): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.createdAt,
  };
}
