import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getConfig } from '@cairn/config';
import { DomainError } from '@cairn/domain';
import type { CairnServices } from '@cairn/ingestion';
import { InsufficientScopeError, McpAuthenticator, wwwAuthenticateHeader } from './auth';
import { wwwAuthenticateChallenge } from './metadata';
import { createMcpServer } from './server';

/**
 * The remote endpoint, over Streamable HTTP.
 *
 * Stateless: a fresh server and transport per request, so no session state can be
 * mistaken for authentication and nothing survives between callers. The bearer
 * token is validated before the MCP server is even constructed, so an
 * unauthenticated request never reaches a tool.
 */
export async function handleMcpRequest(
  request: Request,
  services: CairnServices,
): Promise<Response> {
  const config = services.config ?? getConfig();

  // Rate limited per credential, so a leaked code cannot be used to enumerate.
  const token = McpAuthenticator.bearerFrom(request.headers);
  const limitKey = `mcp:${token ? token.slice(-12) : (request.headers.get('x-forwarded-for') ?? 'anonymous')}`;
  const limit = await services.rateLimiter.check(limitKey, 120, 60_000);
  if (!limit.allowed) {
    return jsonRpcError(429, -32000, 'Too many requests', {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  let auth;
  try {
    auth = await new McpAuthenticator(services.handle, config).authenticate(token);
  } catch (error) {
    // A token that is valid but too narrow is a different answer from one that
    // is not valid at all. Returning 401 for both makes a client throw away a
    // working token and re-run the whole flow, only to be refused again for the
    // same reason; 403 with the scope it needs lets it ask for exactly that.
    if (error instanceof InsufficientScopeError) {
      services.logger.warn('mcp.insufficient_scope', { scope: error.requiredScope });
      return jsonRpcError(403, -32002, 'Insufficient scope', {
        'www-authenticate': wwwAuthenticateChallenge(config, {
          error: 'insufficient_scope',
          scope: [error.requiredScope],
          description: error.userMessage,
        }),
      });
    }
    services.logger.warn('mcp.unauthorized', { reason: (error as Error).message });
    return jsonRpcError(401, -32001, 'Unauthorized', {
      'www-authenticate': wwwAuthenticateHeader(config),
    });
  }

  const server = createMcpServer({ services, actor: auth.actor, clientName: auth.clientName });
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode: the spec allows it, and it removes a whole class of
    // session-fixation questions.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: config.isProduction,
    allowedHosts: config.isProduction ? [new URL(config.appUrl).host] : undefined,
    allowedOrigins: config.isProduction ? [config.appUrl] : undefined,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    const status = error instanceof DomainError ? error.httpStatus : 500;
    services.logger.error('mcp.request_failed', { error, status });
    if (!(error instanceof DomainError)) services.errors.captureException(error, { area: 'mcp' });
    return jsonRpcError(
      status,
      -32603,
      error instanceof DomainError ? error.userMessage : 'Internal error',
    );
  } finally {
    await server.close().catch(() => {});
  }
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
