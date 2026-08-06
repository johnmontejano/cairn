import { type AppConfig, getConfig } from '@cairn/config';
import { mcpScopes } from '@cairn/domain';

/**
 * Discovery documents.
 *
 * This is the half that was missing, and its absence is why pasting Cairn's URL
 * into Claude or ChatGPT could never have worked. A client that meets a 401 has
 * no way to guess where to send someone to sign in; the specification's answer
 * is that the resource server MUST publish Protected Resource Metadata
 * (RFC 9728) and point at it from the `WWW-Authenticate` challenge. Everything
 * else in the flow is downstream of those two facts.
 *
 * Cairn is both the resource server and the authorization server, so both
 * documents are served from the same origin. They stay separate anyway: they
 * are separate roles in the specification, and collapsing them would make it
 * harder to move authorization elsewhere later.
 */

/** The canonical resource identifier, per RFC 8707 §2. No trailing slash. */
export function mcpResourceUri(config: AppConfig = getConfig()): string {
  return `${config.appUrl.replace(/\/$/, '')}/api/mcp`;
}

export function issuerUri(config: AppConfig = getConfig()): string {
  return config.appUrl.replace(/\/$/, '');
}

export function protectedResourceMetadataUrl(config: AppConfig = getConfig()): string {
  return `${issuerUri(config)}/.well-known/oauth-protected-resource`;
}

/**
 * The scopes a client may ask for.
 *
 * `mcpScopes` deliberately excludes everything in `RESERVED_MCP_SCOPES` —
 * `memory:write` among them — so advertising the list wholesale cannot offer a
 * scope that would only ever be refused. Advertising an ungrantable scope
 * invites a client to request it and then fail for a reason the person reading
 * the consent screen cannot act on.
 */
export function grantableScopes(): string[] {
  return [...mcpScopes];
}

export function protectedResourceMetadata(
  config: AppConfig = getConfig(),
): Record<string, unknown> {
  return {
    resource: mcpResourceUri(config),
    authorization_servers: [issuerUri(config)],
    // Deliberately the minimum needed for basic function. Anything beyond
    // reading is requested through a step-up challenge, not granted up front.
    scopes_supported: ['memory:read'],
    bearer_methods_supported: ['header'],
    resource_name: 'Cairn',
    resource_documentation: `${issuerUri(config)}/connections`,
  };
}

export function authorizationServerMetadata(
  config: AppConfig = getConfig(),
): Record<string, unknown> {
  const issuer = issuerUri(config);
  return {
    issuer,
    authorization_endpoint: `${issuer}/connect`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    // `offline_access` is not a Cairn scope and never appears on a consent
    // screen or a token — `parseScopes` drops it on arrival. It is advertised
    // anyway because OpenAI's connector pre-flight looks for it here and warns
    // that access may lapse at token expiry when it is absent, even though
    // Cairn's `refresh_token` grant works regardless. Advertising it costs
    // nothing and removes the one documented obstacle to ChatGPT connecting.
    scopes_supported: [...grantableScopes(), 'offline_access'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // OAuth 2.1 removes `plain`, and every MCP client is a public client, so
    // S256 is the only method offered rather than the preferred one.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    // RFC 9207. The spec expects this to become mandatory, and emitting it now
    // costs nothing while letting careful clients validate against mix-up.
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/connections`,
  };
}

/**
 * The 401 challenge.
 *
 * The parameter that matters is `resource_metadata`: it is the only thing
 * standing between a client and the rest of discovery. The previous version
 * sent `authorization_uri` and `resource`, which are not parameters any client
 * looks for, so the challenge was well-formed HTTP and useless in practice.
 */
export function wwwAuthenticateChallenge(
  config: AppConfig = getConfig(),
  options: { scope?: string[]; error?: string; description?: string } = {},
): string {
  if (config.env.MCP_AUTH_MODE !== 'oauth') {
    return 'Bearer realm="cairn", error="invalid_token", error_description="Use the connection code from Connected AIs"';
  }
  const parts = ['Bearer', `resource_metadata="${protectedResourceMetadataUrl(config)}"`];
  if (options.error) parts.push(`error="${options.error}"`);
  if (options.scope && options.scope.length > 0) {
    parts.push(`scope="${options.scope.join(' ')}"`);
  }
  if (options.description) parts.push(`error_description="${options.description}"`);
  return `${parts[0]} ${parts.slice(1).join(', ')}`;
}
