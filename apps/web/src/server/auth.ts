import { randomBytes, randomInt, randomUUID } from 'node:crypto';
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

  async startEmailSignIn(email: string): Promise<AuthStartResult> {
    return {
      kind: 'redirect',
      challengeId: email,
      url: this.authorizeUrl('authkit', Buffer.from(email).toString('base64url')),
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

export function createAuthProvider(
  handle: DbHandle,
  config: AppConfig = getConfig(),
  announce: (email: string, code: string) => void = defaultAnnounce,
): AuthProvider {
  const { env } = config;
  if (
    env.AUTH_PROVIDER === 'workos' &&
    env.WORKOS_API_KEY &&
    env.WORKOS_CLIENT_ID &&
    env.WORKOS_REDIRECT_URI
  ) {
    return new WorkOsAuthProvider({
      apiKey: env.WORKOS_API_KEY,
      clientId: env.WORKOS_CLIENT_ID,
      redirectUri: env.WORKOS_REDIRECT_URI,
    });
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
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

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
