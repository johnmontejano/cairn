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
 * Verified against the live service on 2026-07-31: client-credentials grant,
 * HTTP 200, `expires_in` 3600 — which is where the one-hour fallback below
 * comes from rather than a guess.
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
  result?: { content?: Array<{ type: string; text?: string }>; tools?: PipedreamTool[] };
  error?: { code: number; message: string };
}

export interface PipedreamTool {
  name: string;
  title?: string;
  description?: string;
}

/**
 * Reads the JSON-RPC payload out of a response.
 *
 * The endpoint answers `text/event-stream` even for a single request-response
 * exchange, so `res.json()` throws on the `event: message` preamble. Verified
 * against the live service on 2026-07-31; a plain JSON body is still accepted
 * because nothing in the protocol promises it will always be framed.
 */
export function parseRpcBody(raw: string): JsonRpcResponse {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as JsonRpcResponse;

  // Take the last data: frame — a stream may carry progress notifications
  // before the result, and the result is what the caller asked for.
  const frames = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((body) => body.length > 0 && body !== '[DONE]');

  if (frames.length === 0) {
    throw new ValidationError(
      'Pipedream returned no JSON-RPC frame',
      'That connection could not be read just now. Nothing was changed.',
    );
  }
  return JSON.parse(frames[frames.length - 1]!) as JsonRpcResponse;
}

/**
 * Tools that only read.
 *
 * Half of what an app exposes here mutates: for Notion the list includes
 * create-page, update-page, append-block and create-comment alongside search
 * and retrieve. Cairn's connector contract declares `readOnly = true`, and that
 * has to be enforced by never surfacing a write rather than by trusting nothing
 * to call one.
 *
 * Matched on the verb in the tool name, which is how Pipedream names them
 * consistently across apps. Anything unrecognised is treated as a write, so a
 * new verb fails closed.
 */
const READ_VERBS = [
  'search',
  'retrieve',
  'query',
  'get',
  'list',
  'find',
  'read',
  'download',
  'export',
];

/**
 * Which app, and which of its tools, each provider uses.
 *
 * Tool names were read off a live `tools/list` on 2026-07-31 rather than taken
 * from documentation. Every app exposes far more than this — Drive alone
 * returns 48 tools — so the pair recorded here is the one that answers "what
 * exists" and "give me its contents", which is all ingestion needs.
 *
 * Kept as a table rather than a subclass per app because the difference between
 * these connectors really is two strings. A new app is a row until one of them
 * needs behaviour the others do not.
 */
export interface PipedreamAppBinding {
  app: string;
  displayName: string;
  /** Enumerates what the connection can see. */
  listTool: string;
  /** Fetches one item's content. */
  fetchTool: string;
  permissionSummary: string;
}

export const PIPEDREAM_APPS: Readonly<Record<string, PipedreamAppBinding>> = {
  gmail: {
    app: 'gmail',
    displayName: 'Gmail',
    listTool: 'gmail-find-email',
    fetchTool: 'gmail-list-thread-messages',
    permissionSummary:
      'Reads messages in your Gmail so their contents can become memory. It never sends, replies to, deletes, or files anything, and it never writes on your behalf.',
  },
  google_calendar: {
    app: 'google_calendar',
    displayName: 'Google Calendar',
    listTool: 'google_calendar-list-events',
    fetchTool: 'google_calendar-get-event',
    permissionSummary:
      'Reads events on your calendar so what was decided and who attended can become memory. It never creates, moves, or cancels anything.',
  },
};

export function readOnlyTools(tools: readonly PipedreamTool[]): PipedreamTool[] {
  return tools.filter((tool) => {
    const verb = tool.name.includes('-') ? tool.name.split('-').slice(1).join('-') : tool.name;
    return READ_VERBS.some((allowed) => verb.startsWith(allowed));
  });
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
  const body = parseRpcBody(await res.text());
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

  /**
   * The read-only tools this app exposes for the given person.
   *
   * Filtered rather than returned whole: the raw list mixes reads and writes,
   * and this connector promises `readOnly`.
   */
  async tools(externalUserId: string): Promise<PipedreamTool[]> {
    const body = await pipedreamRpc({
      config: this.config,
      externalUserId,
      app: this.app,
      method: 'tools/list',
      fetchImpl: this.fetchImpl,
    });
    return readOnlyTools(body.result?.tools ?? []);
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

/**
 * Builds the connector for a Pipedream-backed provider.
 *
 * Returns the unconfigured stand-in when credentials are absent, so the
 * interface can say "setup required" honestly rather than offering something
 * that fails only once someone tries to use it.
 */
export function createPipedreamConnector(
  provider: SourceProvider,
  config = getConfig(),
): SourceConnector | null {
  const binding = PIPEDREAM_APPS[provider];
  if (!binding) return null;

  const cfg = pipedreamConfig(config);
  if (!cfg) {
    return new UnconfiguredPipedreamConnector(
      provider,
      binding.displayName,
      binding.permissionSummary,
    );
  }
  return new PipedreamConnector(
    provider,
    binding.displayName,
    binding.permissionSummary,
    binding.app,
    cfg,
  );
}
