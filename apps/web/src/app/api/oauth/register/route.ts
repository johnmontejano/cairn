import { randomUUID } from 'node:crypto';
import { oauthRepo, withSystem } from '@cairn/db';
import { getServices } from '@cairn/ingestion';
import { grantableScopes } from '@cairn/mcp';

/**
 * Dynamic Client Registration (RFC 7591).
 *
 * The current specification marks this deprecated in favour of Client ID
 * Metadata Documents, but every MCP client shipping today still registers this
 * way, so refusing it would mean refusing the clients this work exists to
 * serve. Both are accepted: a `client_id` that is an HTTPS URL is treated as a
 * metadata document at authorize time, and anything else came from here.
 *
 * Registration is open, as the RFC intends, which makes it the one endpoint an
 * anonymous caller can write to. Three things keep that from being a liability:
 * it is rate limited, it stores no secret, and a registered client can do
 * nothing at all until a signed-in person approves it on the consent screen.
 * A junk registration is an unreferenced row, not access.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const;

const MAX_REDIRECT_URIS = 10;
const MAX_FIELD_LENGTH = 512;

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request): Promise<Response> {
  const services = await getServices();

  const who = request.headers.get('x-forwarded-for') ?? 'anonymous';
  const limit = await services.rateLimiter.check(`oauth:register:${who}`, 10, 60_000);
  if (!limit.allowed) {
    return error('temporarily_unavailable', 'Too many registrations. Try again shortly.', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error('invalid_client_metadata', 'The registration body was not valid JSON.');
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (redirectUris.length === 0) {
    return error('invalid_redirect_uri', 'At least one redirect_uri is required.');
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return error('invalid_redirect_uri', `At most ${MAX_REDIRECT_URIS} redirect URIs.`);
  }
  for (const uri of redirectUris) {
    const problem = validateRedirectUri(uri);
    if (problem) return error('invalid_redirect_uri', problem);
  }

  const clientName = String(body.client_name ?? 'An AI tool').slice(0, 120);
  const clientUri =
    typeof body.client_uri === 'string' ? body.client_uri.slice(0, MAX_FIELD_LENGTH) : null;

  // `cairn_client_` rather than a bare UUID so a client_id is recognisable in a
  // log line, and so it can never be mistaken for the HTTPS URL form that means
  // "fetch my metadata from here".
  const clientId = `cairn_client_${randomUUID()}`;

  const record = await withSystem(services.handle, (tx) =>
    oauthRepo.upsertOauthClient(tx, {
      clientId,
      clientName,
      redirectUris,
      clientUri,
      registrationType: 'dynamic',
    }),
  );

  services.logger.info('oauth.client_registered', { clientId, clientName });

  return Response.json(
    {
      client_id: record.clientId,
      client_id_issued_at: Math.floor(record.createdAt.getTime() / 1000),
      client_name: record.clientName,
      redirect_uris: record.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // No secret is issued. OAuth 2.1 requires PKCE for public clients, and
      // every MCP client is one; handing out a secret that must then ship
      // inside a desktop app would be theatre.
      token_endpoint_auth_method: 'none',
      scope: grantableScopes().join(' '),
    },
    { status: 201, headers: CORS },
  );
}

/**
 * Redirect URIs are the one field worth being strict about.
 *
 * A loopback address or a private-use scheme is how native clients receive the
 * code, so both are allowed. Everything else must be HTTPS: an `http://` URL
 * pointing anywhere but this machine would carry an authorization code across
 * the network in the clear.
 */
function validateRedirectUri(raw: string): string | null {
  if (raw.length > MAX_FIELD_LENGTH) return 'A redirect URI is too long.';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${raw} is not a valid absolute URI.`;
  }
  if (url.hash) return 'A redirect URI must not contain a fragment.';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:') {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
      ? null
      : 'An http redirect URI is only allowed on loopback.';
  }
  // Private-use scheme, e.g. `com.example.app:/callback`, used by native apps.
  return url.protocol.includes('.') ? null : `${url.protocol} is not an allowed redirect scheme.`;
}

function error(
  code: string,
  description: string,
  status = 400,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: code, error_description: description },
    { status, headers: { ...CORS, ...headers } },
  );
}
