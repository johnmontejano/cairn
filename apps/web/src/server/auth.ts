import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type AppConfig, getConfig } from '@cairn/config';
import { sha256Hex } from '@cairn/crypto';
import {
  type DbHandle,
  type Keyring,
  auditRepo,
  schema,
  withSystem,
  workspacesRepo,
} from '@cairn/db';
import {
  type AuthProvider,
  type AuthStartResult,
  SetupRequiredError,
  UnauthorizedError,
  ValidationError,
} from '@cairn/domain';

/**
 * Sign-in.
 *
 * Two providers behind one interface. The local one exists so a fresh checkout
 * works with no external account: it prints the code to the server log instead of
 * emailing it, and says so in the interface rather than pretending an email was
 * sent.
 */

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

export class LocalAuthProvider implements AuthProvider {
  readonly kind = 'fixture' as const;
  readonly status = 'demo' as const;

  constructor(
    private readonly handle: DbHandle,
    private readonly announce: (email: string, code: string) => void,
  ) {}

  async startEmailSignIn(email: string): Promise<AuthStartResult> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = randomUUID();
    await withSystem(this.handle, async (tx) => {
      await tx.insert(schema.authChallenges).values({
        id: challengeId,
        email: email.toLowerCase(),
        // The code itself is never stored.
        codeHash: sha256Hex(`${challengeId}:${code}`),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
    });
    this.announce(email, code);
    return { kind: 'email_code', challengeId, devCode: code };
  }

  async completeEmailSignIn(challengeId: string, code: string) {
    return consumeChallenge(this.handle, challengeId, code);
  }

  async startGoogleSignIn(): Promise<AuthStartResult> {
    throw new SetupRequiredError('Google sign-in', ['WORKOS_CLIENT_ID']);
  }

  async completeOAuth(): Promise<never> {
    throw new SetupRequiredError('Google sign-in', ['WORKOS_CLIENT_ID']);
  }
}

/**
 * WorkOS AuthKit.
 *
 * Hosted sign-in handles the email code and Google, so this app never sees a
 * password. The exchange is done over plain HTTP calls rather than the SDK to
 * keep the dependency surface small and the flow auditable.
 */
export class WorkOsAuthProvider implements AuthProvider {
  readonly kind = 'workos' as const;
  readonly status = 'ready' as const;

  constructor(
    private readonly options: { apiKey: string; clientId: string; redirectUri: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private authorizeUrl(provider: string, state: string): string {
    const url = new URL('https://api.workos.com/user_management/authorize');
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('provider', provider);
    url.searchParams.set('state', state);
    return url.toString();
  }

  // `email` isn't used for `state` (see the CSRF note on `completeOAuth` in
  // ports.ts) — WorkOS's own hosted page collects the email itself. It stays
  // a required parameter to satisfy `AuthProvider`, which `LocalAuthProvider`
  // does need it for.
  async startEmailSignIn(_email: string): Promise<AuthStartResult> {
    const state = randomBytes(24).toString('base64url');
    return {
      kind: 'redirect',
      // Repurposed to carry the nonce the caller must stash in
      // `OAUTH_STATE_COOKIE` before redirecting — there is no challenge row
      // to look up for a hosted-redirect flow, so this field just carries
      // whatever the caller needs to complete the round trip.
      challengeId: state,
      url: this.authorizeUrl('authkit', state),
    };
  }

  async completeEmailSignIn(): Promise<never> {
    throw new ValidationError('WorkOS sign-in completes through the OAuth callback');
  }

  async startGoogleSignIn(state: string): Promise<AuthStartResult> {
    return { kind: 'redirect', challengeId: state, url: this.authorizeUrl('GoogleOAuth', state) };
  }

  async completeOAuth(code: string) {
    const res = await this.fetchImpl('https://api.workos.com/user_management/authenticate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.options.clientId,
        client_secret: this.options.apiKey,
        grant_type: 'authorization_code',
        code,
      }),
    });
    if (!res.ok) throw new UnauthorizedError(`WorkOS rejected the sign-in (${res.status})`);
    const body = (await res.json()) as {
      user: { id: string; email: string; first_name?: string | null; last_name?: string | null };
    };
    const displayName = [body.user.first_name, body.user.last_name].filter(Boolean).join(' ');
    return {
      email: body.user.email,
      externalId: body.user.id,
      displayName: displayName.length > 0 ? displayName : null,
    };
  }
}

async function consumeChallenge(handle: DbHandle, challengeId: string, code: string) {
  return withSystem(handle, async (tx) => {
    const [challenge] = await tx
      .select()
      .from(schema.authChallenges)
      .where(
        and(
          eq(schema.authChallenges.id, challengeId),
          isNull(schema.authChallenges.consumedAt),
          gt(schema.authChallenges.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!challenge) {
      throw new ValidationError(
        'Sign-in code invalid or expired',
        'That code has expired. Ask for a new one.',
      );
    }
    if (challenge.attempts >= MAX_CODE_ATTEMPTS) {
      throw new ValidationError(
        'Too many attempts',
        'Too many attempts on that code. Ask for a new one.',
      );
    }
    if (sha256Hex(`${challengeId}:${code}`) !== challenge.codeHash) {
      await tx
        .update(schema.authChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(schema.authChallenges.id, challengeId));
      throw new ValidationError('Wrong code', 'That code is not right. Check it and try again.');
    }
    await tx
      .update(schema.authChallenges)
      .set({ consumedAt: sql`now()` })
      .where(eq(schema.authChallenges.id, challengeId));
    return { email: challenge.email, externalId: challenge.email, displayName: null };
  });
}

export interface WorkOsConfig {
  apiKey: string;
  clientId: string;
  redirectUri: string;
}

/**
 * Mirrors `googleOAuthConfig()` in `packages/connectors/src/google.ts`: one
 * place that knows which three env vars make WorkOS usable, reused by
 * `createAuthProvider` instead of each caller re-deriving its own "is WorkOS
 * configured" check.
 */
export function workosConfig(config: AppConfig = getConfig()): WorkOsConfig | null {
  const { env } = config;
  if (!env.WORKOS_API_KEY || !env.WORKOS_CLIENT_ID || !env.WORKOS_REDIRECT_URI) return null;
  return {
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID,
    redirectUri: env.WORKOS_REDIRECT_URI,
  };
}

export function createAuthProvider(
  handle: DbHandle,
  config: AppConfig = getConfig(),
  announce: (email: string, code: string) => void = defaultAnnounce,
): AuthProvider {
  if (config.env.AUTH_PROVIDER === 'workos') {
    const options = workosConfig(config);
    if (options) return new WorkOsAuthProvider(options);
  }
  return new LocalAuthProvider(handle, announce);
}

function defaultAnnounce(email: string, code: string): void {
  process.stdout.write(
    `\n──────────────────────────────────────────────\n` +
      `  Sign-in code for ${email}: ${code}\n` +
      `  (Local mode: no email was sent.)\n` +
      `──────────────────────────────────────────────\n\n`,
  );
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'cairn_session';
export const CSRF_COOKIE = 'cairn_csrf';
/**
 * Holds the nonce from `WorkOsAuthProvider.startEmailSignIn` between the
 * redirect to WorkOS and the callback. Short-lived and single-use — the
 * callback route deletes it whether the round trip succeeds or not.
 */
export const OAUTH_STATE_COOKIE = 'cairn_oauth_state';
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
/**
 * Where to land after signing in, when it is not the usual place.
 *
 * Someone who clicked "connect" inside Claude and turned out to be signed out
 * must come back to the consent screen, not to the home page having forgotten
 * why they started. Set immediately before leaving for the identity provider
 * and deleted on the way back.
 */
export const AFTER_SIGNIN_COOKIE = 'cairn_after_signin';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * Narrows a return path to somewhere on this site.
 *
 * A redirect target taken from a query parameter is an open redirector unless
 * something refuses absolute URLs, protocol-relative ones, and anything that is
 * not a plain rooted path. Returns `null` for everything else, and callers fall
 * back to their normal destination — a failure here should be a boring landing,
 * never a redirect somewhere unexpected.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  // `//evil.example` and `/\evil.example` are both read as protocol-relative
  // absolute URLs by browsers, so a leading-slash test alone is not enough.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (raw.length > 512) return null;
  return raw;
}

/**
 * True only when the WorkOS callback's `state` query param exactly matches
 * the nonce stashed in `OAUTH_STATE_COOKIE` before the redirect — a missing
 * cookie, a missing query param, or any mismatch fails closed. Pulled out as
 * its own function so the check is unit-testable independent of the route
 * handler's `next/headers` plumbing.
 */
export function validOAuthState(
  cookieValue: string | undefined,
  queryValue: string | null,
): boolean {
  return Boolean(cookieValue) && Boolean(queryValue) && cookieValue === queryValue;
}

/**
 * Signs the session token for cookie transport with `CAIRN_SESSION_SECRET`,
 * independent of the hash already stored in `sessions.token_hash`. A leaked
 * database row alone is then not enough to forge a session — the secret
 * lives only in server env, never in Postgres. If no secret is configured
 * (fixture/local mode, where it's optional), the token travels unsigned, as
 * it always has.
 */
export function signSessionToken(token: string, secret: string | undefined): string {
  if (!secret) return token;
  const signature = createHmac('sha256', secret).update(token).digest('base64url');
  return `${token}.${signature}`;
}

/**
 * Inverse of `signSessionToken`. Returns the raw token to look up if the
 * signature checks out (or if no secret is configured, matching the
 * unsigned case), and `null` otherwise — including when a secret is
 * configured but the cookie predates it, which forces a one-time re-login
 * rather than silently trusting an unsigned value.
 */
export function verifySessionToken(
  cookieValue: string | undefined,
  secret: string | undefined,
): string | null {
  if (!cookieValue) return null;
  if (!secret) return cookieValue;
  const separator = cookieValue.lastIndexOf('.');
  if (separator < 0) return null;
  const token = cookieValue.slice(0, separator);
  const signature = Buffer.from(cookieValue.slice(separator + 1));
  const expected = Buffer.from(createHmac('sha256', secret).update(token).digest('base64url'));
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  return token;
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  workspaceId: string;
  userId: string;
  projectId: string;
}

export async function signInUser(
  handle: DbHandle,
  keyring: Keyring,
  identity: { email: string; displayName: string | null; externalId: string | null },
  meta: { authProvider: string; userAgent?: string | null; ip?: string | null },
): Promise<CreatedSession> {
  const { user, workspace, project } = await workspacesRepo.provisionUser(handle, keyring, {
    email: identity.email,
    displayName: identity.displayName,
    externalId: identity.externalId,
    authProvider: meta.authProvider,
  });

  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await withSystem(handle, async (tx) => {
    await tx.insert(schema.sessions).values({
      id: randomUUID(),
      // Same reasoning as connection codes: the database stores a hash, so a
      // database read cannot be replayed as a login.
      tokenHash: sha256Hex(token),
      userId: user.id,
      workspaceId: workspace.id,
      csrfSecret: csrfToken,
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    });
    await auditRepo.recordAudit(tx, {
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: 'auth.sign_in',
      metadata: { provider: meta.authProvider },
    });
  });

  return {
    token,
    csrfToken,
    expiresAt,
    workspaceId: workspace.id,
    userId: user.id,
    projectId: project.id,
  };
}

export interface ResolvedSession {
  userId: string;
  workspaceId: string;
  csrfSecret: string;
  email: string;
  displayName: string | null;
}

export async function resolveSession(
  handle: DbHandle,
  token: string | undefined,
): Promise<ResolvedSession | null> {
  if (!token) return null;
  return withSystem(handle, async (tx) => {
    const rows = await tx
      .select({
        userId: schema.sessions.userId,
        workspaceId: schema.sessions.workspaceId,
        csrfSecret: schema.sessions.csrfSecret,
        email: schema.users.email,
        displayName: schema.users.displayName,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(
        and(
          eq(schema.sessions.tokenHash, sha256Hex(token)),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row?.workspaceId) return null;
    return {
      userId: row.userId,
      workspaceId: row.workspaceId,
      csrfSecret: row.csrfSecret,
      email: row.email,
      displayName: row.displayName,
    };
  });
}

export async function revokeSession(handle: DbHandle, token: string | undefined): Promise<void> {
  if (!token) return;
  await withSystem(handle, async (tx) => {
    await tx
      .update(schema.sessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(schema.sessions.tokenHash, sha256Hex(token)));
  });
}
