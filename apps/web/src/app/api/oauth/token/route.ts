import { createHash, timingSafeEqual } from 'node:crypto';
import { oauthRepo, withSystem } from '@cairn/db';
import { getServices } from '@cairn/ingestion';

/**
 * The token endpoint.
 *
 * Two grants: exchanging an authorization code, and refreshing. Both are public
 * client flows — no client secret exists to present — so the proof that the
 * caller is the same party that started the flow is PKCE, not a credential.
 *
 * Errors deliberately do not distinguish between an unknown code, an expired
 * one, and one already used. That distinction helps nobody except someone
 * probing, and the audit trail keeps the real reason.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const;

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request): Promise<Response> {
  const services = await getServices();

  const who = request.headers.get('x-forwarded-for') ?? 'anonymous';
  const limit = await services.rateLimiter.check(`oauth:token:${who}`, 60, 60_000);
  if (!limit.allowed) {
    return error('invalid_request', 'Too many requests.', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const form = await readForm(request);
  if (!form) return error('invalid_request', 'Expected a form-encoded body.');

  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') return exchangeCode(services, form);
  if (grantType === 'refresh_token') return refresh(services, form);
  return error('unsupported_grant_type', `${grantType ?? 'A grant type'} is not supported.`);
}

async function exchangeCode(
  services: Awaited<ReturnType<typeof getServices>>,
  form: URLSearchParams,
): Promise<Response> {
  const code = form.get('code');
  const verifier = form.get('code_verifier');
  const clientId = form.get('client_id');
  const redirectUri = form.get('redirect_uri');

  if (!code || !verifier || !clientId || !redirectUri) {
    return error(
      'invalid_request',
      'code, code_verifier, client_id and redirect_uri are required.',
    );
  }

  const issued = await withSystem(services.handle, async (tx) => {
    const consumed = await oauthRepo.consumeAuthorizationCode(tx, code);
    if (!consumed) return null;

    // Each of these three binds the code to the exact request that created it.
    // A code intercepted from a redirect is useless without the verifier; a
    // code replayed by a different client, or against a different redirect
    // URI, is refused outright.
    if (consumed.oauthClientId !== clientId) return null;
    if (consumed.redirectUri !== redirectUri) return null;
    if (!verifyPkce(verifier, consumed.codeChallenge)) return null;

    return oauthRepo.issueTokens(tx, {
      workspaceId: consumed.workspaceId,
      oauthClientId: consumed.oauthClientId,
      mcpClientId: consumed.mcpClientId,
      scopes: consumed.scopes,
      resource: consumed.resource,
    });
  });

  if (!issued) {
    services.logger.warn('oauth.code_exchange_failed', { clientId });
    return error('invalid_grant', 'That authorization code is not valid.');
  }

  services.logger.info('oauth.tokens_issued', { clientId, scopes: issued.scopes });
  return tokenResponse(issued);
}

async function refresh(
  services: Awaited<ReturnType<typeof getServices>>,
  form: URLSearchParams,
): Promise<Response> {
  const token = form.get('refresh_token');
  if (!token) return error('invalid_request', 'refresh_token is required.');

  const rotated = await withSystem(services.handle, (tx) =>
    oauthRepo.rotateRefreshToken(tx, token),
  );
  if (!rotated) {
    services.logger.warn('oauth.refresh_rejected', {});
    return error('invalid_grant', 'That refresh token is not valid.');
  }
  return tokenResponse(rotated.tokens);
}

/**
 * PKCE S256 verification.
 *
 * Compared in constant time. The comparison is against a value the client
 * committed to before the person ever saw the consent screen, so a timing
 * signal here would leak the one secret standing between an intercepted code
 * and a working token.
 */
function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenResponse(issued: {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: string[];
}): Response {
  return Response.json(
    {
      access_token: issued.accessToken,
      token_type: 'Bearer',
      expires_in: issued.expiresInSeconds,
      refresh_token: issued.refreshToken,
      scope: issued.scopes.join(' '),
    },
    {
      status: 200,
      headers: { ...CORS, 'cache-control': 'no-store', pragma: 'no-cache' },
    },
  );
}

async function readForm(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/x-www-form-urlencoded')) {
      return new URLSearchParams(await request.text());
    }
    // Some clients send JSON here despite the RFC. Accepting it costs nothing
    // and turns a confusing 400 into a working connection.
    if (type.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string') params.set(key, value);
      }
      return params;
    }
  } catch {
    return null;
  }
  return null;
}

function error(
  code: string,
  description: string,
  status = 400,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: code, error_description: description },
    { status, headers: { ...CORS, 'cache-control': 'no-store', ...headers } },
  );
}
