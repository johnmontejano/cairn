'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import {
  EXAMPLE_DOCUMENT,
  EXAMPLE_DOCUMENT_TITLE,
  EXAMPLE_FOLLOW_UP,
  EXAMPLE_FOLLOW_UP_TITLE,
  createConnector,
  fetchUrlSafely,
} from '@cairn/connectors';
import {
  auditRepo,
  clientsRepo,
  deletionRepo,
  jobsRepo,
  memoryRepo,
  schema,
  sourcesRepo,
  usageRepo,
  withTenant,
} from '@cairn/db';
import {
  DomainError,
  ForbiddenError,
  ValidationError,
  type MemoryType,
  type SensitivityLevel,
  type ClientVisibilityPolicy,
  memoryTypes,
} from '@cairn/domain';
import {
  approveMemoryItem,
  commitCanonicalMarkdown,
  rejectMemoryItem,
  resolveConflict,
  submitSource,
} from '@cairn/ingestion';
import { getServices } from '@cairn/ingestion';
import { indexMemoryItems } from '@cairn/search';
import { restoreBackup } from '@cairn/vault';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  createAuthProvider,
  resolveSession,
  revokeSession,
  signInUser,
} from './auth';
import {
  assertCsrf,
  drainQueuedWork,
  enforceRateLimit,
  requireContext,
  resolveProject,
} from './context';

/**
 * Every mutation the website can perform.
 *
 * Each one validates CSRF, re-checks authorization from the session (never from
 * the form), and returns a plain-language message. Errors that a person can act
 * on come back as `{ error }`; anything else is logged and reported as a generic
 * failure rather than leaking internals.
 */

export interface ActionResult {
  ok?: boolean;
  /** Which step of a multi-step flow to show. */
  stage?: 'email' | 'code';
  error?: string;
  message?: string;
  /** Set when an action produces something shown once, like a connection code. */
  secret?: string;
  id?: string;
}

async function guard<T extends ActionResult>(run: () => Promise<T>): Promise<T | ActionResult> {
  try {
    return await run();
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof DomainError) return { error: error.userMessage };
    const services = await getServices();
    services.logger.error('action.failed', { error });
    services.errors.captureException(error, { area: 'web-action' });
    return { error: 'Something went wrong. Please try again.' };
  }
}

function isRedirectError(error: unknown): boolean {
  return (
    typeof (error as { digest?: string })?.digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

/* ------------------------------------------------------------------ *
 * Sign in
 * ------------------------------------------------------------------ */

/**
 * Sign-in, both steps, one action.
 *
 * The step is carried in the returned state rather than in a second hook, so the
 * flow behaves identically whether the browser has finished hydrating or is
 * falling back to a plain form post. Two hooks meant a wrong code could bounce
 * someone back to the email box with no explanation.
 */
export async function continueSignIn(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    const services = await getServices();
    const challengeId = String(formData.get('challengeId') ?? '').trim();

    if (challengeId.length === 0) {
      const email = String(formData.get('email') ?? '')
        .trim()
        .toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { stage: 'email', error: 'That does not look like an email address.' };
      }
      const limit = await services.rateLimiter.check(`signin:${email}`, 5, 15 * 60_000);
      if (!limit.allowed) {
        return { stage: 'email', error: 'Too many sign-in attempts. Try again in a few minutes.' };
      }

      const provider = createAuthProvider(services.handle, services.config);
      const started = await provider.startEmailSignIn(email);
      if (started.kind === 'redirect' && started.url) redirect(started.url);

      return {
        ok: true,
        stage: 'code',
        id: started.challengeId,
        // Shown on screen in local mode only; the interface labels it as such.
        secret: started.devCode,
        message: `We sent a 6-digit code to ${email}.`,
      };
    }

    const code = String(formData.get('code') ?? '').trim();
    const provider = createAuthProvider(services.handle, services.config);
    try {
      const identity = await provider.completeEmailSignIn(challengeId, code);
      const session = await signInUser(services.handle, services.keyring, identity, {
        authProvider: provider.kind,
      });
      await setSessionCookies(session.token, session.csrfToken, session.expiresAt);
    } catch (error) {
      if (isRedirectError(error)) throw error;
      if (error instanceof DomainError) {
        // Stay on the code step, keeping the challenge, so the person can retry.
        return {
          stage: 'code',
          id: challengeId,
          secret: String(formData.get('devCode') ?? '') || undefined,
          error: error.userMessage,
        };
      }
      throw error;
    }
    redirect('/welcome');
  });
}

export async function signOut(): Promise<void> {
  const services = await getServices();
  const jar = await cookies();
  await revokeSession(services.handle, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
  redirect('/');
}

async function setSessionCookies(token: string, csrf: string, expiresAt: Date): Promise<void> {
  const services = await getServices();
  const secure = services.config.appUrl.startsWith('https://');
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  // Readable by the page so forms can echo it back; that is the double-submit half
  // of the CSRF check and is not a secret on its own.
  jar.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

/* ------------------------------------------------------------------ *
 * Adding information
 * ------------------------------------------------------------------ */

export async function addPastedText(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    await enforceRateLimit(context, 'add', 30);

    const text = String(formData.get('text') ?? '').trim();
    const title = String(formData.get('title') ?? '').trim() || 'Pasted note';
    if (text.length < 10) {
      return { error: 'Write a little more — at least a sentence or two.' };
    }
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));

    const result = await submitSource(context.services, {
      actor: context.actor,
      projectId: project.id,
      provider: 'paste',
      // Content-addressed, so pasting the same text twice is recognised.
      externalId: `paste:${await hashOf(text)}`,
      title,
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(text),
    });
    await drainQueuedWork(context.services);
    revalidatePath('/home');
    revalidatePath('/memory');
    revalidatePath('/sources');

    return {
      ok: true,
      id: result.sourceItemId,
      message: result.deduplicated
        ? 'You had already added that, so nothing changed.'
        : 'Added. Look below for what was found.',
    };
  });
}

export async function addUploadedFiles(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    await enforceRateLimit(context, 'add', 30);
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));

    const files = formData
      .getAll('files')
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: 'Choose at least one file.' };

    let added = 0;
    let repeated = 0;
    const problems: string[] = [];
    for (const file of files.slice(0, 10)) {
      try {
        const result = await submitSource(context.services, {
          actor: context.actor,
          projectId: project.id,
          provider: 'upload',
          externalId: `upload:${file.name}`,
          title: file.name,
          mimeType: file.type || 'application/octet-stream',
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
        if (result.deduplicated) repeated += 1;
        else added += 1;
      } catch (error) {
        problems.push(
          `${file.name}: ${error instanceof DomainError ? error.userMessage : 'could not be read'}`,
        );
      }
    }
    await drainQueuedWork(context.services);
    revalidatePath('/home');
    revalidatePath('/sources');

    if (added === 0 && problems.length > 0) return { error: problems.join(' ') };
    return {
      ok: true,
      message: [
        added > 0 ? `Added ${added} file${added === 1 ? '' : 's'}.` : null,
        repeated > 0 ? `${repeated} had not changed since last time.` : null,
        ...problems,
      ]
        .filter(Boolean)
        .join(' '),
    };
  });
}

export async function addWebPage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    await enforceRateLimit(context, 'add-url', 10);
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const url = String(formData.get('url') ?? '').trim();
    if (!url) return { error: 'Paste a web address first.' };

    const fetched = await fetchUrlSafely(url);
    const result = await submitSource(context.services, {
      actor: context.actor,
      projectId: project.id,
      provider: 'url',
      externalId: `url:${fetched.finalUrl}`,
      title: fetched.title,
      mimeType: fetched.mimeType,
      canonicalUri: fetched.finalUrl,
      bytes: fetched.bytes,
    });
    await drainQueuedWork(context.services);
    revalidatePath('/home');
    revalidatePath('/sources');
    return {
      ok: true,
      id: result.sourceItemId,
      message: result.deduplicated
        ? 'That page has not changed since last time.'
        : `Read “${fetched.title}”.`,
    };
  });
}

export async function loadExample(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));

    for (const [title, body] of [
      [EXAMPLE_DOCUMENT_TITLE, EXAMPLE_DOCUMENT],
      [EXAMPLE_FOLLOW_UP_TITLE, EXAMPLE_FOLLOW_UP],
    ] as const) {
      await submitSource(context.services, {
        actor: context.actor,
        projectId: project.id,
        provider: 'paste',
        externalId: `example:${title}`,
        title,
        mimeType: 'text/markdown',
        bytes: new TextEncoder().encode(body),
      });
    }
    await drainQueuedWork(context.services);
    revalidatePath('/home');
    revalidatePath('/memory');
    revalidatePath('/sources');
    return { ok: true, message: 'Loaded an example so you can see how this works.' };
  });
}

/* ------------------------------------------------------------------ *
 * Reviewing memory
 * ------------------------------------------------------------------ */

export async function keepMemory(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const memoryItemId = String(formData.get('memoryItemId') ?? '');
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));

    await approveMemoryItem(context.services, context.actor, {
      memoryItemId,
      projectId: project.id,
      authorLabel: context.displayName ?? context.email,
    });
    revalidateMemoryViews();
    return { ok: true, message: 'Kept.' };
  });
}

export async function removeMemory(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    await rejectMemoryItem(
      context.services,
      context.actor,
      String(formData.get('memoryItemId') ?? ''),
    );
    revalidateMemoryViews();
    return { ok: true, message: 'Removed. You can undo this from History.' };
  });
}

export async function undoRemoveMemory(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const memoryItemId = String(formData.get('memoryItemId') ?? '');

    await withTenant(context.services.handle, context.actor, async (tx) => {
      await tx
        .update(schema.memoryItems)
        .set({ deletedAt: null, status: 'proposed' })
        .where(
          and(
            eq(schema.memoryItems.workspaceId, context.actor.workspaceId),
            eq(schema.memoryItems.id, memoryItemId),
          ),
        );
    });
    revalidateMemoryViews();
    return { ok: true, message: 'Put back into your review list.' };
  });
}

export async function editMemory(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const memoryItemId = String(formData.get('memoryItemId') ?? '');
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const title = String(formData.get('title') ?? '').trim();
    const value = String(formData.get('value') ?? '').trim();
    const sensitivity = String(formData.get('sensitivity') ?? 'normal') as SensitivityLevel;
    const visibility = String(
      formData.get('visibility') ?? 'share_with_authorized_clients',
    ) as ClientVisibilityPolicy;
    if (title.length === 0 || value.length === 0) {
      return { error: 'Give it a short name and something to remember.' };
    }

    const crypto = await context.services.keyring.get(context.actor.workspaceId);
    await withTenant(context.services.handle, context.actor, async (tx) => {
      await memoryRepo.updateMemoryContent(tx, crypto, context.actor.workspaceId, memoryItemId, {
        title,
        value,
        sensitivity,
        visibility,
      });
      const item = await memoryRepo.getMemoryItem(
        tx,
        crypto,
        context.actor.workspaceId,
        memoryItemId,
      );
      if (item?.status === 'approved') {
        await indexMemoryItems(tx, crypto, context.services.embedder, [item]);
        await commitCanonicalMarkdown(tx, crypto, context.services.vault, {
          actor: context.actor,
          projectId: project.id,
          reason: 'Edited a memory',
          authorLabel: context.displayName ?? context.email,
          provenance: { kind: 'user_edit', memoryItemIds: [memoryItemId] },
        });
      }
      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'memory.edited',
        subjectType: 'memory_item',
        subjectId: memoryItemId,
      });
    });
    revalidateMemoryViews();
    return { ok: true, message: 'Saved your wording.' };
  });
}

export async function addMemoryManually(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const type = String(formData.get('type') ?? 'fact') as MemoryType;
    const title = String(formData.get('title') ?? '').trim();
    const value = String(formData.get('value') ?? '').trim();
    if (!memoryTypes.includes(type)) return { error: 'Pick a kind of memory.' };
    if (title.length === 0 || value.length === 0) {
      return { error: 'Give it a short name and something to remember.' };
    }

    // Typing something yourself is still a source: it becomes a document you can
    // cite, so the "everything has evidence" rule holds without exception.
    const result = await submitSource(context.services, {
      actor: context.actor,
      projectId: project.id,
      provider: 'paste',
      externalId: `manual:${await hashOf(`${title}\n${value}`)}`,
      title: `You wrote: ${title}`,
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(`# ${title}\n\n${value}\n`),
    });

    const crypto = await context.services.keyring.get(context.actor.workspaceId);
    await withTenant(context.services.handle, context.actor, async (tx) => {
      const revision = await tx
        .select({ id: schema.sourceRevisions.id })
        .from(schema.sourceRevisions)
        .where(
          and(
            eq(schema.sourceRevisions.workspaceId, context.actor.workspaceId),
            eq(schema.sourceRevisions.sourceItemId, result.sourceItemId),
          ),
        )
        .limit(1);
      const revisionId = revision[0]?.id;
      if (!revisionId) throw new ValidationError('Could not store that note');

      const item = await memoryRepo.insertMemoryItem(tx, crypto, {
        workspaceId: context.actor.workspaceId,
        projectId: project.id,
        type,
        status: 'proposed',
        title,
        value,
        topics: [],
        sensitivity: 'normal',
        extractionMethod: 'user_manual',
        confidence: 1,
      });
      const body = `# ${title}\n\n${value}\n`;
      const start = body.indexOf(value);
      await memoryRepo.addEvidence(tx, crypto, {
        workspaceId: context.actor.workspaceId,
        memoryItemId: item.id,
        sourceItemId: result.sourceItemId,
        sourceRevisionId: revisionId,
        startOffset: start,
        endOffset: start + value.length,
        excerpt: value,
        locator: 'Written by you',
      });
      await tx.insert(schema.memoryProposals).values({
        id: crypto_randomUUID(),
        workspaceId: context.actor.workspaceId,
        projectId: project.id,
        memoryItemId: item.id,
        origin: 'user',
      });
    });

    await drainQueuedWork(context.services);
    revalidateMemoryViews();
    return { ok: true, message: 'Added to your review list.' };
  });
}

export async function resolveMemoryConflict(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const conflictId = String(formData.get('conflictId') ?? '');
    const keepId = String(formData.get('keepMemoryItemId') ?? '');
    const crypto = await context.services.keyring.get(context.actor.workspaceId);

    await withTenant(context.services.handle, context.actor, async (tx) => {
      await resolveConflict(tx, {
        workspaceId: context.actor.workspaceId,
        conflictId,
        keepMemoryItemId: keepId,
        resolvedBy: context.actor.userId,
      });
      const kept = await memoryRepo.getMemoryItem(tx, crypto, context.actor.workspaceId, keepId);
      if (kept) await indexMemoryItems(tx, crypto, context.services.embedder, [kept]);
      await commitCanonicalMarkdown(tx, crypto, context.services.vault, {
        actor: context.actor,
        projectId: project.id,
        reason: 'Resolved a disagreement',
        authorLabel: context.displayName ?? context.email,
        provenance: { kind: 'user_edit', memoryItemIds: [keepId] },
      });
      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'memory.conflict_resolved',
        subjectType: 'memory_conflict',
        subjectId: conflictId,
      });
    });
    revalidateMemoryViews();
    return { ok: true, message: 'Saved. The other version is kept in your history.' };
  });
}

/* ------------------------------------------------------------------ *
 * Connections
 * ------------------------------------------------------------------ */

export async function connectSource(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const provider = String(formData.get('provider') ?? '') as 'google_drive' | 'github';
    if (!['google_drive', 'github'].includes(provider)) return { error: 'Unknown connection.' };

    const connector = createConnector(provider, context.services.config);
    const status = connector?.status() ?? 'setup-required';
    const crypto = await context.services.keyring.get(context.actor.workspaceId);

    const connectionId = await withTenant(context.services.handle, context.actor, async (tx) => {
      const connection = await sourcesRepo.createConnection(tx, crypto, {
        workspaceId: context.actor.workspaceId,
        projectId: project.id,
        provider,
        displayName: connector?.displayName ?? provider,
        // An unconfigured provider is recorded honestly rather than pretending.
        state: status === 'ready' ? 'active' : 'setup_required',
        scopes: provider === 'google_drive' ? ['drive.readonly'] : ['contents:read'],
        externalAccountLabel: status === 'ready' ? null : 'Demo data',
      });
      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'source.connected',
        subjectType: 'source_connection',
        subjectId: connection.id,
        metadata: { provider, status },
      });
      return connection.id;
    });

    revalidatePath('/sources');
    return {
      ok: true,
      id: connectionId,
      message:
        status === 'ready'
          ? 'Connected. Choose “Check for updates” to read it now.'
          : 'Added in demo form. Real access needs setup by whoever runs this app — see Settings.',
    };
  });
}

export async function syncConnection(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    await enforceRateLimit(context, 'sync', 20);
    const connectionId = String(formData.get('connectionId') ?? '');
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));

    await withTenant(context.services.handle, context.actor, (tx) =>
      jobsRepo.enqueueIn(tx, {
        workspaceId: context.actor.workspaceId,
        projectId: project.id,
        type: 'connection.sync',
        // Time-bucketed so double-clicking cannot start two syncs, while an
        // intentional retry a minute later still works.
        idempotencyKey: `sync:${connectionId}:${Math.floor(Date.now() / 60_000)}`,
        payload: { connectionId },
      }),
    );
    await drainQueuedWork(context.services);
    revalidatePath('/sources');
    revalidatePath('/home');
    return { ok: true, message: 'Checked for updates.' };
  });
}

export async function disconnectSource(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const connectionId = String(formData.get('connectionId') ?? '');

    await withTenant(context.services.handle, context.actor, async (tx) => {
      await sourcesRepo.disconnectConnection(tx, context.actor.workspaceId, connectionId);
      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'source.disconnected',
        subjectType: 'source_connection',
        subjectId: connectionId,
      });
    });
    revalidatePath('/sources');
    return {
      ok: true,
      message:
        'Disconnected. The stored permission was deleted; memory already saved is untouched.',
    };
  });
}

/* ------------------------------------------------------------------ *
 * Connected AIs
 * ------------------------------------------------------------------ */

export async function createConnectedAi(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const name = String(formData.get('name') ?? '').trim() || 'My AI assistant';
    const allowProposals = formData.get('allowProposals') === 'on';
    const includeSensitive = formData.get('includeSensitive') === 'on';

    const created = await withTenant(context.services.handle, context.actor, async (tx) => {
      const result = await clientsRepo.createMcpClient(tx, {
        workspaceId: context.actor.workspaceId,
        name,
        scopes: allowProposals ? ['memory:read', 'memory:propose'] : ['memory:read'],
        projectIds: null,
        maxSensitivity: includeSensitive ? 'sensitive' : 'normal',
      });
      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'mcp.client_created',
        subjectType: 'mcp_client',
        subjectId: result.client.id,
        metadata: { name, scopes: result.client.scopes },
      });
      return result;
    });

    revalidatePath('/connections');
    return {
      ok: true,
      id: created.client.id,
      secret: created.token,
      message: 'Copy this code now — it is shown once.',
    };
  });
}

export async function revokeConnectedAi(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const clientId = String(formData.get('clientId') ?? '');
    await withTenant(context.services.handle, context.actor, async (tx) => {
      await clientsRepo.revokeMcpClient(tx, context.actor.workspaceId, clientId);
      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'mcp.client_revoked',
        subjectType: 'mcp_client',
        subjectId: clientId,
      });
    });
    revalidatePath('/connections');
    return { ok: true, message: 'Turned off. That code stops working immediately.' };
  });
}

/* ------------------------------------------------------------------ *
 * Settings, restore, deletion
 * ------------------------------------------------------------------ */

export async function saveWorkspaceSettings(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const budget = Number(formData.get('budget') ?? 5);
    if (!Number.isFinite(budget) || budget < 0 || budget > 10_000) {
      return { error: 'Enter a monthly limit between 0 and 10000.' };
    }
    await withTenant(context.services.handle, context.actor, (tx) =>
      usageRepo.saveSettings(tx, context.actor.workspaceId, {
        aiMonthlyBudgetUsd: budget,
        aiHardLimitEnabled: formData.get('hardLimit') === 'on',
        privacyMode: formData.get('privacyMode') === 'on',
        retentionDaysRaw: Math.max(1, Number(formData.get('retentionDays') ?? 365)),
      }),
    );
    revalidatePath('/settings');
    return { ok: true, message: 'Settings saved.' };
  });
}

export async function restoreFromBackup(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const file = formData.get('backup');
    const passphrase = String(formData.get('passphrase') ?? '');
    const dryRun = formData.get('dryRun') === 'on';
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose your backup file.' };
    if (passphrase.length < 10) return { error: 'Enter the passphrase you chose for this backup.' };

    const report = await restoreBackup(
      context.services.handle,
      context.services.keyring,
      context.actor,
      {
        archive: new Uint8Array(await file.arrayBuffer()),
        passphrase,
        projectId: project.id,
        dryRun,
        authorLabel: context.displayName ?? context.email,
      },
    );

    if (!dryRun) {
      const crypto = await context.services.keyring.get(context.actor.workspaceId);
      await withTenant(context.services.handle, context.actor, async (tx) => {
        const items = await memoryRepo.listMemoryItems(tx, crypto, {
          workspaceId: context.actor.workspaceId,
          projectId: project.id,
          statuses: ['approved'],
          limit: 1000,
        });
        await indexMemoryItems(tx, crypto, context.services.embedder, items);
        await auditRepo.recordAudit(tx, {
          workspaceId: context.actor.workspaceId,
          actorUserId: context.actor.userId,
          action: 'restore.performed',
          metadata: {
            memoryItems: report.restored.memoryItems,
            hashMatches: report.manifestHash.matches,
          },
        });
      });
      revalidateMemoryViews();
    }

    const failures = report.checks.filter((c) => !c.ok);
    if (failures.length > 0) return { error: failures.map((f) => f.detail).join(' ') };
    return {
      ok: true,
      message: dryRun
        ? `Checked: ${report.restored.memoryItems} memories, ${report.restored.documents} documents, fingerprints match.`
        : `Restored ${report.restored.memoryItems} memories and ${report.restored.documents} documents.`,
    };
  });
}

export async function deleteEverything(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    if (context.actor.role !== 'owner')
      throw new ForbiddenError('Only the owner can delete a workspace');
    if (
      String(formData.get('confirm') ?? '')
        .trim()
        .toLowerCase() !== 'delete everything'
    ) {
      return { error: 'Type "delete everything" exactly to confirm.' };
    }

    await withTenant(context.services.handle, context.actor, (tx) =>
      deletionRepo.requestDeletion(tx, {
        workspaceId: context.actor.workspaceId,
        requestedBy: context.actor.userId,
        scope: 'workspace',
      }),
    );
    const report = await deletionRepo.deleteWorkspace(
      context.services.handle,
      context.actor.workspaceId,
    );
    context.services.keyring.forget(context.actor.workspaceId);
    context.services.logger.info('workspace.deleted', { removed: report.removed });

    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    jar.delete(CSRF_COOKIE);
    redirect('/?deleted=1');
  });
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function revalidateMemoryViews(): void {
  revalidatePath('/home');
  revalidatePath('/memory');
  revalidatePath('/history');
  revalidatePath('/ask');
}

async function hashOf(value: string): Promise<string> {
  const { contentHash } = await import('@cairn/crypto');
  return contentHash(value).replace('sha256:', '').slice(0, 32);
}

function crypto_randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/** Used by the sign-in page to know whether a session already exists. */
export async function hasSession(): Promise<boolean> {
  const services = await getServices();
  const jar = await cookies();
  return (await resolveSession(services.handle, jar.get(SESSION_COOKIE)?.value)) !== null;
}
