import { getConfig } from '@cairn/config';
import {
  type FetchedSource,
  type SourceConnector,
  type SourceProvider,
  SetupRequiredError,
  ValidationError,
} from '@cairn/domain';

/**
 * Pipedream Connect, as a generic connector backend.
 *
 * Every hand-written connector in this package costs the same work twice: an
 * OAuth dance, then a bespoke list-and-fetch against one provider's API.
 * Pipedream hosts both halves for ~3,000 apps behind one contract, so adding an
 * app becomes a slug rather than a file.
 *
 * The shape that makes this work for a multi-tenant product is
 * `x-pd-external-user-id`: one Pipedream project serves every Cairn user, and
 * each user's connected accounts stay scoped to their own id. Cairn sends its
 * own workspace-scoped identifier and never has to mint per-user projects.
 *
 * Transport is plain JSON-RPC over HTTP rather than the MCP SDK, matching the
 * reasoning already applied to WorkOS in apps/web/src/server/auth.ts: a smaller
 * dependency surface, and a request you can read in a log without decoding a
 * client library's framing.
 *
 * Credentials are never held by Cairn. Account linking happens through a
 * Connect Link that the person opens themselves, so access tokens for Gmail or
 * Drive live at Pipedream and this process only ever holds its own project
 * token.
 */

const MCP_BASE = 'https://remote.mcp.pipedream.net/v3';

/**
 * Token endpoint for the project-level credential.
 *
 * NOT verified against live documentation: pipedream.com/docs returned 502 on
 * every path when this was written, so this is the conventional OAuth2
 * client-credentials endpoint for their API rather than a confirmed one. It is
 * isolated here, and in one constant, precisely so correcting it is a one-line
 * change once the credentials exist and a real call can be made.
 */
const TOKEN_ENDPOINT = 'https://api.pipedream.com/v1/oauth/token';

export interface PipedreamConfig {
  projectId: string;
  environment: string;
  clientId: string;
  clientSecret: string;
}

export function pipedreamConfig(config = getConfig()): PipedreamConfig | null {
  const { env } = config;
  if (!env.PIPEDREAM_PROJECT_ID || !env.PIPEDREAM_CLIENT_ID || !env.PIPEDREAM_CLIENT_SECRET) {
    return null;
  }
  return {
    projectId: env.PIPEDREAM_PROJECT_ID,
    environment: env.PIPEDREAM_ENVIRONMENT ?? 'development',
    clientId: env.PIPEDREAM_CLIENT_ID,
    clientSecret: env.PIPEDREAM_CLIENT_SECRET,
  };
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Project-level access token.
 *
 * Cached in memory because it is per-deployment rather than per-user: refetching
 * it on every connector call would add a round trip to every sync for no gain.
 * The 60s margin covers clock skew between here and Pipedream.
 */
let cachedToken: CachedToken | null = null;

export async function pipedreamAccessToken(
  config: PipedreamConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!res.ok) {
    throw new ValidationError(
      `Pipedream token request failed (${res.status})`,
      'Could not reach the connection service. Nothing was changed.',
    );
  }
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.accessToken;
}

/** Clears the cached project token. Exists so tests do not leak state. */
export function resetPipedreamToken(): void {
  cachedToken = null;
}

/**
 * A one-click link the person opens to authorize an app.
 *
 * Returned to the browser rather than followed here: the whole point is that
 * the credential exchange happens between the person and Pipedream, so no part
 * of this system is ever in a position to see it.
 */
export function pipedreamConnectUrl(input: { token: string; app: string }): string {
  const url = new URL('https://pipedream.com/_static/connect.html');
  url.searchParams.set('token', input.token);
  url.searchParams.set('connectLink', 'true');
  url.searchParams.set('app', input.app);
  return url.toString();
}

interface JsonRpcResponse {
  result?: { content?: Array<{ type: string; text?: string }>; tools?: unknown[] };
  error?: { code: number; message: string };
}

/**
 * One JSON-RPC call against an app's MCP endpoint, scoped to one user.
 *
 * The four `x-pd-*` headers are the entire multi-tenant story: project and
 * environment identify the deployment, `external-user-id` selects whose
 * connected account to act as, and `app-slug` selects which app's tools the
 * server exposes.
 */
export async function pipedreamRpc(input: {
  config: PipedreamConfig;
  externalUserId: string;
  app: string;
  method: string;
  params?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<JsonRpcResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await pipedreamAccessToken(input.config, fetchImpl);
  const res = await fetchImpl(MCP_BASE, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-pd-project-id': input.config.projectId,
      'x-pd-environment': input.config.environment,
      'x-pd-external-user-id': input.externalUserId,
      'x-pd-app-slug': input.app,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: input.method,
      params: input.params ?? {},
    }),
  });
  if (!res.ok) {
    throw new ValidationError(
      `Pipedream ${input.method} failed for ${input.app} (${res.status})`,
      'That connection could not be read just now. Nothing was changed.',
    );
  }
  const body = (await res.json()) as JsonRpcResponse;
  if (body.error) {
    throw new ValidationError(
      `Pipedream ${input.method} error: ${body.error.message}`,
      'That connection could not be read just now. Nothing was changed.',
    );
  }
  return body;
}

/**
 * A connector backed by Pipedream for one app.
 *
 * Tool names differ per app and are discovered at run time through `tools/list`
 * rather than hardcoded, because guessing them without a live credential would
 * mean shipping a mapping nobody has ever executed. Once credentials exist, the
 * discovered names can be pinned per app if the round trip proves costly.
 */
export class PipedreamConnector implements SourceConnector {
  readonly readOnly = true as const;

  constructor(
    readonly provider: SourceProvider,
    readonly displayName: string,
    readonly permissionSummary: string,
    private readonly app: string,
    private readonly config: PipedreamConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): 'ready' {
    return 'ready';
  }

  /** The tools this app exposes for the given person. */
  async tools(externalUserId: string): Promise<unknown[]> {
    const body = await pipedreamRpc({
      config: this.config,
      externalUserId,
      app: this.app,
      method: 'tools/list',
      fetchImpl: this.fetchImpl,
    });
    return body.result?.tools ?? [];
  }

  async list(input: {
    connectionId: string;
    cursor: string | null;
    credential: string | null;
  }): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    // The credential column holds Cairn's own external-user id for this
    // connection, not a provider token: Pipedream holds the token.
    if (!input.credential) {
      throw new SetupRequiredError(this.displayName, ['connection credential']);
    }
    const parsed = JSON.parse(input.credential) as { externalUserId?: string };
    if (!parsed.externalUserId) {
      throw new SetupRequiredError(this.displayName, ['external user id on this connection']);
    }

    // Deliberately not implemented against guessed tool names. Discovery works
    // and is exercised by `tools()`; mapping each app's list-and-fetch tools to
    // FetchedSource needs one live credential to verify against, and inventing
    // that mapping now would be the kind of untested success this project
    // refuses to fake.
    throw new SetupRequiredError(this.displayName, [
      'verified Pipedream tool mapping (needs PIPEDREAM_CLIENT_ID and PIPEDREAM_CLIENT_SECRET)',
    ]);
  }
}

/**
 * Stands in when Pipedream credentials are absent.
 *
 * Reports `setup-required` rather than returning sample data, because unlike
 * Drive or Notion there is no single provider whose sample content would be
 * meaningful here.
 */
export class UnconfiguredPipedreamConnector implements SourceConnector {
  readonly readOnly = true as const;

  constructor(
    readonly provider: SourceProvider,
    readonly displayName: string,
    readonly permissionSummary: string,
  ) {}

  status(): 'setup-required' {
    return 'setup-required';
  }

  async list(): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    throw new SetupRequiredError(this.displayName, [
      'PIPEDREAM_CLIENT_ID',
      'PIPEDREAM_CLIENT_SECRET',
    ]);
  }
}
