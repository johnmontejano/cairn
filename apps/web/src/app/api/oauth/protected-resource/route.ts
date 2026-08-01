import { getConfig } from '@cairn/config';
import { protectedResourceMetadata } from '@cairn/mcp';

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Reached as `/.well-known/oauth-protected-resource` through a rewrite. This is
 * the first document a client fetches after meeting a 401, and the only thing
 * that tells it which authorization server to use. Unauthenticated on purpose:
 * a client has no token yet, which is precisely why it is here.
 *
 * CORS is open because browser-based MCP clients fetch this cross-origin before
 * any credential exists. The document is public metadata and contains nothing
 * that is not already implied by the endpoint's existence.
 */
export const dynamic = 'force-dynamic';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
} as const;

export async function GET(): Promise<Response> {
  return Response.json(protectedResourceMetadata(getConfig()), {
    headers: { ...CORS, 'cache-control': 'public, max-age=3600' },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}
