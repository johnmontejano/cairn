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
  CALENDAR_SCOPES,
  DRIVE_SCOPES,
  GMAIL_SCOPES,
  createConnector,
  createPipedreamConnectLink,
  fetchUrlSafely,
  googleAuthorizeUrl,
  googleOAuthConfig,
  pipedreamConfig,
  CONNECTOR_DESCRIPTIONS,
  PIPEDREAM_APPS,
} from '@cairn/connectors';
import { callbackUrl, validateAuthorizationRequest } from './oauth-request';
import {
  auditRepo,
  clientsRepo,
  deletionRepo,
  jobsRepo,
  memoryRepo,
  oauthRepo,
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
  type SourceProvider,
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
import { IDENTITY_MAX_CHARS, indexMemoryItems } from '@cairn/search';
import { restoreBackup } from '@cairn/vault';
import {
  CSRF_COOKIE,
  AFTER_SIGNIN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  safeReturnPath,
  SESSION_COOKIE,
  createAuthProvider,
  resolveSession,
  revokeSession,
  signInUser,
  signSessionToken,
  verifySessionToken,
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
  /**
   * Where the person has to go to finish. Set when an action cannot complete on
   * its own because authorising happens somewhere else, so the interface can
   * hand them a link rather than claiming to be done.
   */
  handoffUrl?: string;
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
    // Carried through both branches: the hosted-page round trip stores it in a
    // cookie for the callback route, and the email-code branch reads it back at
    // the end of this same action.
    const returnTo = safeReturnPath(String(formData.get('next') ?? '') || null);

    if (challengeId.length === 0) {
      const provider = createAuthProvider(services.handle, services.config);

      // A hosted provider collects the email itself on its own page — asking
      // for it here first would mean typing it twice into two different
      // forms, the second one having thrown the first away. This app never
      // sees it, so there is nothing here to validate or rate-limit by; the
      // hosted page is where that protection actually lives.
      if (provider.kind !== 'fixture') {
        const started = await provider.startEmailSignIn('');
        if (started.kind === 'redirect' && started.url) {
          await setOAuthStateCookie(started.challengeId);
          await setAfterSignInCookie(returnTo);
          redirect(started.url);
        }
        // A hosted provider should always redirect; this is a fallback for a
        // misconfigured one, not a path anyone is expected to hit.
        return { stage: 'email', error: 'Sign-in is not available right now.' };
      }

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

      const started = await provider.startEmailSignIn(email);
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
    redirect(returnTo ?? '/welcome');
  });
}

export async function signOut(): Promise<void> {
  const services = await getServices();
  const jar = await cookies();
  const token = verifySessionToken(
    jar.get(SESSION_COOKIE)?.value,
    services.config.env.CAIRN_SESSION_SECRET,
  );
  if (token) await revokeSession(services.handle, token);
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
  redirect('/');
}

async function setSessionCookies(token: string, csrf: string, expiresAt: Date): Promise<void> {
  const services = await getServices();
  const secure = services.config.appUrl.startsWith('https://');
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSessionToken(token, services.config.env.CAIRN_SESSION_SECRET), {
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

async function setOAuthStateCookie(state: string): Promise<void> {
  const services = await getServices();
  const secure = services.config.appUrl.startsWith('https://');
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_TTL_MS / 1000,
  });
}

/** Remembers where to land after signing in, when it is not `/welcome`. */
async function setAfterSignInCookie(path: string | null): Promise<void> {
  if (!path) return;
  const services = await getServices();
  const secure = services.config.appUrl.startsWith('https://');
  const jar = await cookies();
  jar.set(AFTER_SIGNIN_COOKIE, path, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_TTL_MS / 1000,
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

/**
 * Approving every eligible proposed memory from one source in a single request.
 *
 * The page only ever sends ids it already decided are eligible — proposed,
 * not conflicted, not sensitive — so this trusts the list the same way
 * {@link keepMemory} trusts a single id: `withTenant` inside `approveMemoryItem`
 * scopes every write to the caller's own workspace regardless of what is
 * submitted. This runs the same per-item approval `keepMemory` uses, in a
 * loop, rather than adding a second code path — the fix for "49 individual
 * decisions" is one request instead of 49, not a different approval rule.
 * One item failing (e.g. it was removed by someone else a moment earlier)
 * does not stop the rest; the message reports what actually happened.
 */
export async function keepAllFromSource(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const memoryItemIds = [...new Set(formData.getAll('memoryItemId').map(String).filter(Boolean))];
    if (memoryItemIds.length === 0) return { error: 'Nothing to keep.' };

    let kept = 0;
    let firstError: string | null = null;
    for (const memoryItemId of memoryItemIds) {
      try {
        await approveMemoryItem(context.services, context.actor, {
          memoryItemId,
          projectId: project.id,
          authorLabel: context.displayName ?? context.email,
        });
        kept += 1;
      } catch (error) {
        if (isRedirectError(error)) throw error;
        firstError =
          error instanceof DomainError
            ? error.userMessage
            : 'Something went wrong for one of them.';
      }
    }
    // One revalidate for the whole batch, not one per item and not one per
    // client round trip — this is what makes "Keep all" a single request.
    revalidateMemoryViews();

    if (kept === 0) {
      return { error: firstError ?? 'Could not keep any of them. Please try again.' };
    }
    const skipped = memoryItemIds.length - kept;
    return {
      ok: true,
      message:
        skipped === 0
          ? `Kept ${kept} from this source. Reversible — remove any of them below, or from History.`
          : `Kept ${kept} of ${memoryItemIds.length} from this source (${skipped} could not be kept${
              firstError ? `: ${firstError}` : ''
            }). Reversible — remove any of them below, or from History.`,
    };
  });
}

/**
 * Removing every proposed memory from one source in a single request.
 *
 * The mirror of {@link keepAllFromSource}, and needed for the same reason: a
 * newsletter or a marketing mail routinely yields a handful of things nobody
 * wants remembered, and dismissing them one at a time is the work the grouping
 * exists to remove. Turning a batch down should cost exactly what trusting one
 * does.
 *
 * This rejects rather than deletes — `rejectMemoryItem` soft-deletes and writes
 * an audit entry, so History can still show what happened and undo it. Nothing
 * here destroys the underlying document; the source stays exactly where it was.
 */
export async function removeAllFromSource(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const memoryItemIds = [...new Set(formData.getAll('memoryItemId').map(String).filter(Boolean))];
    if (memoryItemIds.length === 0) return { error: 'Nothing to remove.' };

    let removed = 0;
    let firstError: string | null = null;
    for (const memoryItemId of memoryItemIds) {
      try {
        await rejectMemoryItem(context.services, context.actor, memoryItemId);
        removed += 1;
      } catch (error) {
        if (isRedirectError(error)) throw error;
        firstError =
          error instanceof DomainError
            ? error.userMessage
            : 'Something went wrong for one of them.';
      }
    }
    revalidateMemoryViews();

    if (removed === 0) {
      return { error: firstError ?? 'Could not remove any of them. Please try again.' };
    }
    const skipped = memoryItemIds.length - removed;
    return {
      ok: true,
      message:
        skipped === 0
          ? `Removed ${removed} from this source. Reversible — put any of them back from History.`
          : `Removed ${removed} of ${memoryItemIds.length} from this source (${skipped} could not be removed${
              firstError ? `: ${firstError}` : ''
            }). Reversible — put any of them back from History.`,
    };
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

/**
 * What each connection reads, recorded on the row so the interface can show it.
 * Notion has no scope strings — access is whatever the person shares with the
 * integration — so its entry records intent only.
 */
const CONNECTION_SCOPES: Partial<Record<SourceProvider, string[]>> = {
  google_drive: ['drive.readonly'],
  github: ['contents:read'],
  notion: ['pages:read'],
  gmail: ['mail:read'],
  google_calendar: ['events:read'],
};

/**
 * Real Google OAuth scopes, as opposed to the display-only ones above. Present
 * for exactly the providers that share the Google Cloud client in
 * @cairn/connectors's google.ts — used to build the authorize handoff below.
 */
const GOOGLE_SCOPES_BY_PROVIDER: Partial<Record<SourceProvider, readonly string[]>> = {
  google_drive: DRIVE_SCOPES,
  gmail: GMAIL_SCOPES,
  google_calendar: CALENDAR_SCOPES,
};

export async function connectSource(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const provider = String(formData.get('provider') ?? '') as SourceProvider;
    // Validated against the registry the Sources page renders from, not a list
    // kept here by hand. Gmail and Calendar shipped with exactly that drift:
    // listed, marked Ready, and refused on click with "Unknown connection".
    if (!CONNECTOR_DESCRIPTIONS[provider]?.needsAccount) {
      return { error: 'Unknown connection.' };
    }

    const connector = createConnector(provider, context.services.config);
    const status = connector?.status() ?? 'setup-required';
    const crypto = await context.services.keyring.get(context.actor.workspaceId);
    const binding = PIPEDREAM_APPS[provider];

    const connectionId = await withTenant(context.services.handle, context.actor, async (tx) => {
      const connection = await sourcesRepo.createConnection(tx, crypto, {
        workspaceId: context.actor.workspaceId,
        projectId: project.id,
        provider,
        displayName: connector?.displayName ?? provider,
        // An unconfigured provider is recorded honestly rather than pretending.
        state: status === 'ready' ? 'active' : 'setup_required',
        scopes: CONNECTION_SCOPES[provider] ?? [],
        // A Pipedream connection authenticates by this workspace's external
        // user id rather than a stored token, and a later sync needs it to ask
        // Pipedream for the right account. It is known now, so it is stored now.
        credential:
          binding && status === 'ready'
            ? JSON.stringify({ externalUserId: `cairn:${context.actor.workspaceId}` })
            : undefined,
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

    // No provider this action can reach finishes authorising here: it always
    // happens between the person and the provider, and this process never sees
    // the credential either way. So the record exists, and they are handed a
    // link rather than told they are connected when they are not.
    let handoffUrl: string | undefined;
    if (binding && status === 'ready') {
      const pdConfig = pipedreamConfig(context.services.config);
      if (pdConfig) {
        const link = await createPipedreamConnectLink(pdConfig, {
          // Stable per workspace, and opaque: anyone holding this could mint a
          // link that attaches their account to this memory.
          externalUserId: `cairn:${context.actor.workspaceId}`,
          app: binding.app,
        });
        handoffUrl = link.url;
      }
    }
    const googleScopes = GOOGLE_SCOPES_BY_PROVIDER[provider];
    if (googleScopes && status === 'ready') {
      const oauth = googleOAuthConfig(context.services.config);
      if (oauth) {
        // `state` is the connection's own id: the callback looks up this exact
        // row rather than trusting anything else in the redirect.
        handoffUrl = googleAuthorizeUrl(oauth, googleScopes, connectionId);
      }
    }

    revalidatePath('/sources');
    return {
      ok: true,
      id: connectionId,
      handoffUrl,
      message: handoffUrl
        ? `Open the link to sign in to ${connector?.displayName ?? provider}. Nothing is read until you do.`
        : status === 'ready'
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

/**
 * Which memory types a new connection may read, as submitted.
 *
 * Three states, and the difference between the last two matters:
 *
 *   - The form did not offer the choice at all (no `memoryTypesOffered` marker)
 *     — `null`, every type, exactly as before this option existed.
 *   - Every type ticked — also `null`, deliberately, rather than a list naming
 *     all eight. A person who narrowed nothing should keep reading everything,
 *     including memory types added after they connected; freezing today's list
 *     into the row would quietly withhold tomorrow's.
 *   - A subset ticked — that subset, and only that subset.
 *
 * Nothing ticked is rejected by the caller rather than resolved here: it is
 * the one input with no sensible reading, since a connection that may read no
 * kind of memory is a connection that does nothing.
 */
function readMemoryTypes(formData: FormData): MemoryType[] | null | 'none' {
  if (formData.get('memoryTypesOffered') !== '1') return null;
  const selected = formData
    .getAll('memoryTypes')
    .map(String)
    .filter((t): t is MemoryType => (memoryTypes as readonly string[]).includes(t));
  if (selected.length === 0) return 'none';
  return selected.length === memoryTypes.length ? null : selected;
}

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
    const grantedTypes = readMemoryTypes(formData);
    if (grantedTypes === 'none') {
      return { error: 'Choose at least one kind of memory this tool may read.' };
    }

    const created = await withTenant(context.services.handle, context.actor, async (tx) => {
      const result = await clientsRepo.createMcpClient(tx, {
        workspaceId: context.actor.workspaceId,
        name,
        scopes: allowProposals ? ['memory:read', 'memory:propose'] : ['memory:read'],
        projectIds: null,
        memoryTypes: grantedTypes,
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

/**
 * Approving an AI tool's connection request.
 *
 * The whole authorization request is re-read from the form and re-validated
 * against the database rather than trusted as submitted. The page already
 * validated it once to decide what to show, but a form is a thing a caller
 * controls, and "it was checked when we rendered it" is not a check.
 *
 * On approval this creates an ordinary `mcp_clients` row — the same kind the
 * connection-code path creates — so listing, revoking and auditing a connection
 * work identically whichever way it was made. There is exactly one notion of a
 * connected AI in this product, and one place to turn it off.
 */
export async function approveAiConnection(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();

    const params = new URLSearchParams(String(formData.get('request') ?? ''));
    const includeSensitive = formData.get('includeSensitive') === 'on';
    const grantedTypes = readMemoryTypes(formData);
    if (grantedTypes === 'none') {
      return { error: 'Choose at least one kind of memory this tool may read.' };
    }

    const outcome = await withTenant(context.services.handle, context.actor, async (tx) => {
      const validated = await validateAuthorizationRequest(tx, params);
      if (validated.kind === 'show') {
        return { error: `${validated.title}. ${validated.detail}` } as const;
      }
      if (validated.kind === 'redirect') {
        return {
          to: callbackUrl(validated.redirectUri, {
            error: validated.error,
            error_description: validated.description,
            state: validated.state,
          }),
        } as const;
      }

      const { request } = validated;
      const { client } = await clientsRepo.createMcpClient(tx, {
        workspaceId: context.actor.workspaceId,
        name: request.client.clientName,
        scopes: request.scopes,
        projectIds: null,
        memoryTypes: grantedTypes,
        maxSensitivity: includeSensitive ? 'sensitive' : 'normal',
      });

      await tx
        .update(schema.mcpClients)
        .set({ oauthClientId: request.client.clientId })
        .where(
          and(
            eq(schema.mcpClients.workspaceId, context.actor.workspaceId),
            eq(schema.mcpClients.id, client.id),
          ),
        );

      const { code } = await oauthRepo.createAuthorizationCode(tx, {
        workspaceId: context.actor.workspaceId,
        oauthClientId: request.client.clientId,
        mcpClientId: client.id,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scopes: request.scopes,
        resource: request.resource,
        grantedBy: context.actor.userId,
      });

      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'mcp.oauth_granted',
        subjectType: 'mcp_client',
        subjectId: client.id,
        metadata: {
          oauthClientId: request.client.clientId,
          name: request.client.clientName,
          scopes: request.scopes,
        },
      });

      return {
        to: callbackUrl(request.redirectUri, { code, state: request.state }),
      } as const;
    });

    if ('error' in outcome) return { error: outcome.error };
    revalidatePath('/connections');
    redirect(outcome.to);
  });
}

/** Refusing the request, told to the client rather than left to time out. */
export async function denyAiConnection(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const params = new URLSearchParams(String(formData.get('request') ?? ''));

    const outcome = await withTenant(context.services.handle, context.actor, async (tx) => {
      const validated = await validateAuthorizationRequest(tx, params);
      // A request too malformed to redirect anywhere is simply dropped; there
      // is no verified address to report the refusal to.
      if (validated.kind === 'show') return null;
      const target =
        validated.kind === 'redirect'
          ? { uri: validated.redirectUri, state: validated.state }
          : { uri: validated.request.redirectUri, state: validated.request.state };
      return callbackUrl(target.uri, {
        error: 'access_denied',
        error_description: 'The person declined this connection.',
        state: target.state,
      });
    });

    if (!outcome) return { error: 'That connection request was not valid.' };
    redirect(outcome);
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
      // Access tokens outlive a revocation by up to an hour otherwise. The
      // token lookup already joins to this row and would refuse it, but killing
      // the tokens outright means revocation does not depend on that join
      // staying correct — someone turning a connection off is entitled to have
      // it stop, not to have it stop provided one query is written a certain way.
      await oauthRepo.revokeTokensForMcpClient(tx, context.actor.workspaceId, clientId);
      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'mcp.client_revoked',
        subjectType: 'mcp_client',
        subjectId: clientId,
      });
    });
    revalidatePath('/connections');
    return { ok: true, message: 'Turned off. It stops working immediately.' };
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

/**
 * Replaces — or clears — the summary a connected AI reads first.
 *
 * This is the editor that was deliberately not exposed over MCP: whoami reads
 * the summary, but changing it happens only here, behind the person's own
 * sign-in. Saving an empty box is how you go back to the automatic version,
 * and that is stated on the form rather than left to be discovered.
 */
export async function updateIdentity(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    await assertCsrf(formData);
    const context = await requireContext();
    const text = String(formData.get('identity') ?? '').trim();
    if (text.length > IDENTITY_MAX_CHARS) {
      return {
        error: `That is ${text.length} characters. The summary is capped at ${IDENTITY_MAX_CHARS} because it travels with every request a connected AI makes.`,
      };
    }

    const cleared = text.length === 0;
    await withTenant(context.services.handle, context.actor, async (tx) => {
      await tx
        .update(schema.workspaceSettings)
        .set({
          identityMarkdown: cleared ? null : text,
          identityUpdatedAt: cleared ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaceSettings.workspaceId, context.actor.workspaceId));
      await auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'settings.updated',
        metadata: { field: 'identity', cleared, chars: text.length },
      });
    });

    revalidatePath('/settings');
    return {
      ok: true,
      message: cleared
        ? 'Cleared. The summary goes back to building itself from what you keep.'
        : 'Saved. Connected AIs now read exactly what you wrote.',
    };
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
  const token = verifySessionToken(
    jar.get(SESSION_COOKIE)?.value,
    services.config.env.CAIRN_SESSION_SECRET,
  );
  if (!token) return false;
  return (await resolveSession(services.handle, token)) !== null;
}
