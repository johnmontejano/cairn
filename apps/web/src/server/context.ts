import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { schema, withTenant, workspacesRepo } from '@cairn/db';
import {
  type ActorContext,
  type Project,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from '@cairn/domain';
import { type CairnServices, drainJobs, getServices } from '@cairn/ingestion';
import { CSRF_COOKIE, SESSION_COOKIE, resolveSession } from './auth';

/**
 * Request context.
 *
 * Every page and action starts here, and nothing reads the database without an
 * `ActorContext` obtained from a real session. There is no "current user" global
 * to forget to check.
 */

export interface RequestContext {
  services: CairnServices;
  actor: ActorContext;
  email: string;
  displayName: string | null;
  csrfSecret: string;
  project: Project;
  projects: Project[];
}

export async function currentContext(): Promise<RequestContext | null> {
  const services = await getServices();
  const jar = await cookies();
  const session = await resolveSession(services.handle, jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const role = await workspacesRepo.resolveMembership(
    services.handle,
    session.userId,
    session.workspaceId,
  );
  const headerBag = await headers();
  const actor: ActorContext = {
    userId: session.userId,
    workspaceId: session.workspaceId,
    role,
    ip: headerBag.get('x-forwarded-for'),
    userAgent: headerBag.get('user-agent'),
  };

  const projects = await withTenant(services.handle, actor, (tx) =>
    workspacesRepo.listProjects(tx, actor.workspaceId),
  );
  const project = projects[0];
  if (!project) throw new NotFoundError('project');

  return {
    services,
    actor,
    email: session.email,
    displayName: session.displayName,
    csrfSecret: session.csrfSecret,
    project,
    projects,
  };
}

export async function requireContext(): Promise<RequestContext> {
  const context = await currentContext();
  if (!context) redirect('/');
  return context;
}

/** Resolves a project the caller actually owns, defaulting to their first. */
export async function resolveProject(
  context: RequestContext,
  projectId?: string | null,
): Promise<Project> {
  if (!projectId) return context.project;
  const found = context.projects.find((p) => p.id === projectId);
  if (!found) throw new ForbiddenError('That project belongs to another workspace');
  return found;
}

/* ------------------------------------------------------------------ *
 * Cross-site request forgery
 * ------------------------------------------------------------------ */

/**
 * Two independent checks, because either alone has a known gap: the Origin header
 * catches classic cross-site posts, and the double-submit token catches the cases
 * where Origin is absent.
 */
export async function assertSameOrigin(): Promise<void> {
  const headerBag = await headers();
  const origin = headerBag.get('origin');
  if (!origin) return;
  const host = headerBag.get('host');
  if (!host) throw new ForbiddenError('Missing host header');
  const expected = new Set([`https://${host}`, `http://${host}`]);
  if (!expected.has(origin)) {
    throw new ForbiddenError(`Cross-origin request from ${origin} refused`);
  }
}

export async function assertCsrf(formData: FormData): Promise<void> {
  await assertSameOrigin();
  const jar = await cookies();
  const cookieToken = jar.get(CSRF_COOKIE)?.value;
  const formToken = formData.get('csrf');
  if (!cookieToken || typeof formToken !== 'string' || formToken !== cookieToken) {
    throw new ForbiddenError('This form has expired. Reload the page and try again.');
  }
}

export async function csrfToken(): Promise<string> {
  const jar = await cookies();
  return jar.get(CSRF_COOKIE)?.value ?? '';
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

export async function enforceRateLimit(
  context: RequestContext,
  action: string,
  limit: number,
  windowMs = 60_000,
): Promise<void> {
  const result = await context.services.rateLimiter.check(
    `${action}:${context.actor.workspaceId}`,
    limit,
    windowMs,
  );
  if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
}

/**
 * Runs queued work inline when there is no separate worker to do it.
 *
 * Two situations need this. The local database is a single-process file, so a
 * worker cannot open it at the same time as the website. And a single-user
 * deployment on free hosting may not want to pay for a second process at all.
 *
 * Either way the work is real: the same handlers, claimed through the same
 * queue, with the same retries. It just happens inside the request that caused
 * it. `CAIRN_INLINE_JOBS=never` forces a worker instead.
 */
export async function drainQueuedWork(services: CairnServices): Promise<void> {
  if (!services.config.inlineJobs) return;
  await drainJobs(services, { maxRounds: 12, batch: 8 });
}

export async function workspaceName(context: RequestContext): Promise<string> {
  return withTenant(context.services.handle, context.actor, async (tx) => {
    const [row] = await tx
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, context.actor.workspaceId))
      .limit(1);
    return row?.name ?? 'Your memory';
  });
}
