import { createRemoteJWKSet, jwtVerify } from 'jose';
import { type AppConfig, getConfig } from '@cairn/config';
import { sha256Hex } from '@cairn/crypto';
import { type DbHandle, clientsRepo, oauthRepo, withSystem } from '@cairn/db';
import {
  type ActorContext,
  type McpScope,
  type MemoryType,
  type SensitivityLevel,
  DomainError,
  UnauthorizedError,
  mcpScopes,
} from '@cairn/domain';
import { mcpResourceUri, wwwAuthenticateChallenge } from './metadata';

/**
 * Who is calling, and what are they allowed to see.
 *
 * The rules here are the ones the MCP security guidance is emphatic about: a
 * session identifier is never a credential, tokens are validated for issuer,
 * audience and expiry before anything else happens, and the resulting actor
 * carries only the scopes actually granted.
 */

export interface McpAuthResult {
  actor: ActorContext;
  clientId: string;
  clientName: string;
  scopes: McpScope[];
}

/**
 * A valid token that is not permitted to do this.
 *
 * Distinct from `UnauthorizedError` on purpose: the specification asks for 403
 * with `error="insufficient_scope"` here, not 401. The difference is not
 * pedantry — a client meeting a 401 discards its token and starts the whole
 * authorization flow again, whereas a 403 with a `scope` parameter tells it
 * exactly which additional permission to ask for and lets it step up without
 * losing what it already has.
 */
export class InsufficientScopeError extends DomainError {
  constructor(readonly requiredScope: string) {
    super(
      `Token lacks scope ${requiredScope}`,
      'insufficient_scope',
      403,
      'That AI tool has not been given permission for this.',
    );
  }
}

export class McpAuthenticator {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    private readonly handle: DbHandle,
    private readonly config: AppConfig = getConfig(),
  ) {}

  /**
   * `null` means "no credential presented" — the caller answers 401 with a
   * `WWW-Authenticate` challenge rather than treating it as a server error.
   */
  static bearerFrom(headers: Headers): string | null {
    const header = headers.get('authorization') ?? headers.get('Authorization');
    if (!header) return null;
    const [scheme, ...rest] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
    const token = rest.join(' ').trim();
    return token.length > 0 ? token : null;
  }

  async authenticate(token: string | null): Promise<McpAuthResult> {
    if (!token) throw new UnauthorizedError('No bearer token presented');
    if (this.config.env.MCP_AUTH_MODE !== 'oauth') return this.authenticateLocal(token);

    // Cairn-issued tokens are self-identifying by prefix, so the common path
    // costs one indexed lookup and never touches the network. An external
    // issuer, if one is configured, is tried only for tokens that are not ours.
    if (token.startsWith(oauthRepo.tokenPrefixes.access)) return this.authenticateIssued(token);
    if (this.config.env.MCP_OAUTH_ISSUER) return this.authenticateExternal(token);
    throw new UnauthorizedError('That access token is not valid');
  }

  /**
   * Tokens Cairn issued itself.
   *
   * The audience check the specification requires is a string comparison
   * against the resource recorded when the token was minted, rather than a
   * claim parsed out of a JWT. A token bound to a different resource is refused
   * even though its hash matched — which is the whole point of RFC 8707, and
   * the step whose omission lets a token for one service be replayed at
   * another.
   */
  private async authenticateIssued(token: string): Promise<McpAuthResult> {
    const resolved = await withSystem(this.handle, (tx) => oauthRepo.findAccessToken(tx, token));
    if (!resolved) throw new UnauthorizedError('That access token is not valid or has expired');

    if (resolved.resource !== mcpResourceUri(this.config)) {
      throw new UnauthorizedError('That token was issued for a different resource');
    }
    if (resolved.scopes.length === 0) {
      throw new InsufficientScopeError('memory:read');
    }

    return {
      actor: {
        userId: null,
        workspaceId: resolved.workspaceId,
        role: 'viewer',
        client: {
          id: resolved.mcpClientId,
          name: resolved.clientName,
          scopes: resolved.scopes,
          projectIds: resolved.projectIds,
          memoryTypes: resolved.memoryTypes,
          maxSensitivity: resolved.maxSensitivity,
        },
      },
      clientId: resolved.mcpClientId,
      clientName: resolved.clientName,
      scopes: resolved.scopes,
    };
  }

  /**
   * Local mode: the connection code the person copied out of the website.
   *
   * Compared by hash, so the database never holds anything replayable, and only
   * usable from this machine because the endpoint is not exposed publicly in
   * demo mode.
   */
  private async authenticateLocal(token: string): Promise<McpAuthResult> {
    const client = await withSystem(this.handle, (tx) => clientsRepo.findClientByToken(tx, token));
    if (!client) throw new UnauthorizedError('That connection code is not valid');
    if (client.revokedAt) throw new UnauthorizedError('That connection has been turned off');

    await withSystem(this.handle, (tx) => clientsRepo.touchClient(tx, client.id));
    return {
      actor: {
        userId: null,
        workspaceId: client.workspaceId,
        role: 'viewer',
        client: {
          id: client.id,
          name: client.name,
          scopes: client.scopes,
          projectIds: client.projectIds,
          memoryTypes: client.memoryTypes,
          maxSensitivity: client.maxSensitivity,
        },
      },
      clientId: client.id,
      clientName: client.name,
      scopes: client.scopes,
    };
  }

  /**
   * Tokens from an external issuer, when one is configured.
   *
   * Retained rather than deleted because a deployment may want its own identity
   * provider to be the authorization server. It requires `mcp_clients.subject`
   * to have been populated by that provider's grant; nothing in Cairn's own
   * flow writes it, so this path is inert unless deliberately wired up.
   *
   * Audience is checked explicitly. A token minted for a different resource is
   * rejected even if its signature is perfectly valid — that is the whole point
   * of RFC 8707 resource indicators, and skipping it is how a token for one
   * service gets replayed against another.
   */
  private async authenticateExternal(token: string): Promise<McpAuthResult> {
    const { env } = this.config;
    if (!env.MCP_OAUTH_ISSUER || !env.MCP_OAUTH_JWKS_URL || !env.MCP_OAUTH_AUDIENCE) {
      throw new UnauthorizedError('OAuth is selected but not configured');
    }
    this.jwks ??= createRemoteJWKSet(new URL(env.MCP_OAUTH_JWKS_URL));

    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(token, this.jwks, {
        issuer: env.MCP_OAUTH_ISSUER,
        audience: env.MCP_OAUTH_AUDIENCE,
        clockTolerance: 30,
      });
      payload = verified.payload as Record<string, unknown>;
    } catch (error) {
      throw new UnauthorizedError(`Token rejected: ${(error as Error).message}`);
    }

    const subject = typeof payload.sub === 'string' ? payload.sub : null;
    const workspaceId =
      typeof payload.workspace_id === 'string'
        ? payload.workspace_id
        : typeof payload.org_id === 'string'
          ? payload.org_id
          : null;
    if (!subject || !workspaceId) {
      throw new UnauthorizedError('Token is missing a subject or workspace');
    }

    const granted = parseScopes(payload.scope ?? payload.scp);
    const client = await withSystem(this.handle, (tx) =>
      clientsRepo.findClientBySubject(tx, workspaceId, subject),
    );
    if (!client) {
      throw new UnauthorizedError('No connection has been approved for that identity');
    }

    // The effective scopes are the intersection: a token cannot widen what the
    // person granted in the website, and the website cannot widen the token.
    const scopes = client.scopes.filter((s) => granted.includes(s));
    if (scopes.length === 0) throw new UnauthorizedError('No overlapping scopes were granted');

    await withSystem(this.handle, (tx) => clientsRepo.touchClient(tx, client.id));
    return {
      actor: {
        userId: null,
        workspaceId,
        role: 'viewer',
        client: {
          id: client.id,
          name: client.name,
          scopes,
          projectIds: client.projectIds,
          memoryTypes: client.memoryTypes as MemoryType[] | null,
          maxSensitivity: client.maxSensitivity as SensitivityLevel,
        },
      },
      clientId: client.id,
      clientName: client.name,
      scopes,
    };
  }
}

function parseScopes(raw: unknown): McpScope[] {
  const list =
    typeof raw === 'string' ? raw.split(/[\s,]+/) : Array.isArray(raw) ? raw.map(String) : [];
  return list.filter((s): s is McpScope => (mcpScopes as readonly string[]).includes(s));
}

/**
 * The challenge sent with a 401, pointing a client at where to get a token.
 *
 * Delegates to `wwwAuthenticateChallenge`, which emits the `resource_metadata`
 * parameter clients actually read. The previous version named the issuer
 * directly through `authorization_uri`, which no client looks for, so discovery
 * stopped dead at the first 401.
 */
export function wwwAuthenticateHeader(config: AppConfig = getConfig()): string {
  return wwwAuthenticateChallenge(config, { error: 'invalid_token' });
}

/** Exposed for tests: proves a stored token hash cannot be replayed as a token. */
export function hashConnectionToken(token: string): string {
  return sha256Hex(token);
}
