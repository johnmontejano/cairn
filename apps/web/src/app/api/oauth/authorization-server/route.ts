import { getConfig } from '@cairn/config';
import { authorizationServerMetadata } from '@cairn/mcp';

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Reached as `/.well-known/oauth-authorization-server` through a rewrite. A
 * client arrives here from the `authorization_servers` entry in the protected
 * resource metadata, and leaves knowing where to send someone to approve the
 * connection and where to exchange the resulting code.
 */
export const dynamic = 'force-dynamic';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
} as const;

export async function GET(): Promise<Response> {
  return Response.json(authorizationServerMetadata(getConfig()), {
    headers: { ...CORS, 'cache-control': 'public, max-age=3600' },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}
