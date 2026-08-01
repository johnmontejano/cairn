import { getConfig } from '@cairn/config';
import { ValidationError } from '@cairn/domain';

/**
 * OAuth plumbing shared by every Google-family connector.
 *
 * Drive, Gmail and Calendar are three products behind one OAuth app: a person
 * authorizes once per Google Cloud client, and which product they are
 * authorizing is entirely a matter of which scopes get requested. Splitting the
 * authorize/exchange/refresh functions out of googleDrive.ts, which used to own
 * them outright, is what makes adding a second product a connector file rather
 * than a second OAuth integration.
 *
 * This was written to close a real gap found on 2026-08-01: these functions
 * existed and were exported, but nothing in the app ever called
 * googleAuthorizeUrl. Drive could be marked "ready" and still have no path to
 * an actual credential, because the connect action only ever built a handoff
 * link for Pipedream-backed providers. See connectSource in actions.ts.
 */

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleOAuthConfig(config = getConfig()): GoogleOAuthConfig | null {
  const { env } = config;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

export function googleAuthorizeUrl(
  config: GoogleOAuthConfig,
  scopes: readonly string[],
  state: string,
): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', state);
  return url.toString();
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

const USERINFO_SCOPE = 'https://www.googleapis.com/auth/userinfo';

export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  expectedScopes: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new ValidationError(`Google token exchange failed (${res.status})`);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  // Refuse a grant broader than what was asked for, whichever product asked.
  const granted = (body.scope ?? '').split(' ').filter(Boolean);
  if (granted.some((s) => !expectedScopes.includes(s) && !s.startsWith(USERINFO_SCOPE))) {
    throw new ValidationError(
      `Unexpected Google scopes granted: ${granted.join(' ')}`,
      'The permissions granted were wider than requested, so the connection was refused.',
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

export async function refreshGoogleToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new ValidationError(`Google token refresh failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: body.access_token,
    refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

/** A still-valid access token, refreshing first only if it is close to expiry. */
export async function freshAccessToken(
  config: GoogleOAuthConfig,
  tokens: GoogleTokens,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (tokens.expiresAt > Date.now() + 30_000) return tokens.accessToken;
  if (!tokens.refreshToken) {
    throw new ValidationError(
      'Google access token expired with no refresh token on file',
      'That connection needs reconnecting.',
    );
  }
  return (await refreshGoogleToken(config, tokens.refreshToken, fetchImpl)).accessToken;
}
