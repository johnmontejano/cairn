import { getConfig } from '@cairn/config';
import { type McpScope, mcpScopes } from '@cairn/domain';
import { oauthRepo } from '@cairn/db';
import { mcpResourceUri } from '@cairn/mcp';
import type { CairnTx } from '@cairn/db';

type OauthClientRecord = Awaited<ReturnType<typeof oauthRepo.findOauthClient>> & object;

/**
 * Validating an authorization request before a person is asked to approve it.
 *
 * The ordering here is deliberate and is a security property, not a style
 * choice. Until `client_id` and `redirect_uri` are both known good, an error
 * must be shown on Cairn's own page and never redirected anywhere — bouncing an
 * error to an unvalidated `redirect_uri` is exactly how an open redirector is
 * built. Only after both check out may anything be sent back to the client,
 * including a refusal.
 */

export interface ValidAuthorizationRequest {
  client: OauthClientRecord;
  redirectUri: string;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
  state: string | null;
}

/** A problem that must be rendered on Cairn's page, because nothing is trusted yet. */
export interface UnredirectableError {
  kind: 'show';
  title: string;
  detail: string;
}

/** A problem the client is entitled to be told about, at a verified redirect URI. */
export interface RedirectableError {
  kind: 'redirect';
  redirectUri: string;
  error: string;
  description: string;
  state: string | null;
}

export type AuthorizationRequestResult =
  { kind: 'ok'; request: ValidAuthorizationRequest } | UnredirectableError | RedirectableError;

export async function validateAuthorizationRequest(
  tx: CairnTx,
  params: URLSearchParams,
): Promise<AuthorizationRequestResult> {
  const config = getConfig();
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const state = params.get('state');

  if (!clientId) {
    return show('This connection request is incomplete', 'It did not say which tool is asking.');
  }

  // A client_id that is an HTTPS URL means a Client ID Metadata Document, which
  // the current spec prefers over dynamic registration. Cairn does not fetch
  // those yet, and saying so plainly beats failing with a generic "unknown
  // client" that sends someone hunting for a registration they never made.
  if (/^https?:\/\//i.test(clientId)) {
    return show(
      'That tool uses a sign-in method Cairn does not support yet',
      'It identifies itself with a metadata URL. Cairn currently registers tools individually instead. Use a connection code from Connected AIs, which works with every tool today.',
    );
  }

  const client = await oauthRepo.findOauthClient(tx, clientId);
  if (!client) {
    return show(
      'Cairn does not recognise that tool',
      'The tool has not registered with this Cairn. If you were sent here from a link you did not expect, close this page.',
    );
  }

  if (!redirectUri) {
    return show('This connection request is incomplete', 'It did not say where to send you back.');
  }
  // Exact string match against what was registered. Prefix or host matching is
  // how an attacker smuggles a code to a path the real client does not own.
  if (!client.redirectUris.includes(redirectUri)) {
    return show(
      'That tool asked to return to an unexpected place',
      'The address it wants to send you back to is not one it registered. Nothing has been shared.',
    );
  }

  // From here the redirect URI is trusted, so errors may travel to the client.
  if (params.get('response_type') !== 'code') {
    return back(
      redirectUri,
      'unsupported_response_type',
      'Only the code flow is supported.',
      state,
    );
  }

  const codeChallenge = params.get('code_challenge');
  const method = params.get('code_challenge_method');
  if (!codeChallenge) {
    return back(redirectUri, 'invalid_request', 'A PKCE code_challenge is required.', state);
  }
  if (method !== 'S256') {
    return back(redirectUri, 'invalid_request', 'code_challenge_method must be S256.', state);
  }

  // The audience the resulting token will be bound to. Clients MUST send this;
  // when one does not, defaulting to this server's own canonical URI is both
  // the only sensible reading and the value that makes the token narrowest.
  const requested = params.get('resource');
  const resource = mcpResourceUri(config);
  if (requested && normalizeResource(requested) !== resource) {
    return back(
      redirectUri,
      'invalid_target',
      'That token was requested for a different server.',
      state,
    );
  }

  const scopes = parseScopes(params.get('scope'));
  if (scopes.length === 0) {
    return back(redirectUri, 'invalid_scope', `Ask for one of: ${mcpScopes.join(', ')}.`, state);
  }

  return {
    kind: 'ok',
    request: { client, redirectUri, codeChallenge, scopes, resource, state },
  };
}

/**
 * Requested scopes, narrowed to what can actually be granted.
 *
 * An unknown scope is dropped rather than refused: a client asking for
 * something Cairn does not offer should still get the parts it can have. An
 * empty result is refused, because that means it asked for nothing usable.
 * Absent entirely, the least-privilege default is read.
 */
function parseScopes(raw: string | null): McpScope[] {
  if (raw === null) return ['memory:read'];
  const asked = raw.split(/[\s,]+/).filter(Boolean);
  const granted = asked.filter((s): s is McpScope => (mcpScopes as readonly string[]).includes(s));
  return [...new Set(granted)];
}

/** Trailing slashes are not significant here; nothing else is normalized. */
function normalizeResource(raw: string): string {
  return raw.replace(/\/$/, '');
}

function show(title: string, detail: string): UnredirectableError {
  return { kind: 'show', title, detail };
}

function back(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null,
): RedirectableError {
  return { kind: 'redirect', redirectUri, error, description, state };
}

/**
 * Builds the URL a client is sent back to.
 *
 * `iss` is included on both success and error responses (RFC 9207). The spec
 * expects this to become mandatory, and a client that validates it is protected
 * against having a code from one authorization server accepted as though it
 * came from another.
 */
export function callbackUrl(redirectUri: string, fields: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  url.searchParams.set('iss', getConfig().appUrl.replace(/\/$/, ''));
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}
