import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export * from './product';

/**
 * Loads `.env.local` then `.env` for processes Next.js does not start (the
 * worker, the CLIs, the test runner). Existing environment variables always win,
 * so a real deployment's configuration is never overwritten by a stray file.
 */
export function loadEnvFiles(cwd = process.cwd()): void {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(cwd, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

/*
 * Deliberately NOT called at import time. Next.js loads `.env.local` itself, and
 * a filesystem read during module initialisation makes its dependency tracing
 * pull in the entire project. Processes Next does not start call this explicitly.
 */

/**
 * Runtime configuration.
 *
 * Two guarantees this module exists to provide:
 *  1. The app never silently half-configures an integration. Either every value a
 *     provider needs is present, or that provider reports `setup-required` and the
 *     rest of the product keeps working.
 *  2. Secrets are read here and nowhere else, so it is auditable that no secret is
 *     exported to the browser (nothing here is prefixed `NEXT_PUBLIC_`).
 */

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      if (typeof v === 'boolean') return v;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** `demo` = no external accounts required. `cloud` = hosted providers configured. */
  CAIRN_MODE: z.enum(['demo', 'cloud']).default('demo'),
  CAIRN_APP_URL: z.string().default('http://localhost:3000'),
  /** Where demo-mode local state lives (PGlite data dir, dev key, uploads). */
  CAIRN_LOCAL_DATA_DIR: z.string().default('.cairn'),

  /** base64-encoded 32-byte master key encrypting per-workspace data keys. */
  CAIRN_MASTER_KEY: optionalStr,
  CAIRN_MASTER_KEY_VERSION: z.string().default('v1'),
  /** `env` reads the master key from CAIRN_MASTER_KEY; `kms` calls an external KMS. */
  CAIRN_KEY_PROVIDER: z.enum(['env', 'kms']).default('env'),
  CAIRN_KMS_KEY_ID: optionalStr,
  CAIRN_KMS_ENDPOINT: optionalStr,

  /** Postgres connection string. Absent => PGlite (local, file-backed real Postgres). */
  DATABASE_URL: optionalStr,
  DATABASE_SSL: bool(true),

  AUTH_PROVIDER: z.enum(['fixture', 'workos']).default('fixture'),
  WORKOS_API_KEY: optionalStr,
  WORKOS_CLIENT_ID: optionalStr,
  WORKOS_REDIRECT_URI: optionalStr,
  /** >=32 chars; encrypts the session cookie payload. */
  CAIRN_SESSION_SECRET: optionalStr,

  AI_PROVIDER: z.enum(['fixture', 'openai', 'local']).default('fixture'),
  OPENAI_API_KEY: optionalStr,
  OPENAI_BASE_URL: optionalStr,
  OPENAI_EXTRACTION_MODEL: z.string().default('gpt-5-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  /** Any OpenAI-compatible local endpoint (Ollama, LM Studio, llama.cpp server...). */
  LOCAL_AI_BASE_URL: optionalStr,
  LOCAL_AI_EXTRACTION_MODEL: optionalStr,
  LOCAL_AI_EMBEDDING_MODEL: optionalStr,

  STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_URL: optionalStr,
  SUPABASE_SERVICE_ROLE_KEY: optionalStr,
  SUPABASE_STORAGE_BUCKET: z.string().default('cairn-raw-sources'),

  QUEUE_PROVIDER: z.enum(['postgres', 'supabase']).default('postgres'),
  CAIRN_QUEUE_NAME: z.string().default('cairn_jobs'),

  /**
   * Whether the web process drains the job queue itself.
   *
   * `auto` drains only against the local single-process database, where a
   * separate worker cannot open the same file. `always` lets a single-user
   * deployment run with no worker at all — the same handlers, claimed through
   * the same queue, just inside the request. `never` forces a worker.
   */
  CAIRN_INLINE_JOBS: z.enum(['auto', 'always', 'never']).default('auto'),

  GOOGLE_CLIENT_ID: optionalStr,
  GOOGLE_CLIENT_SECRET: optionalStr,
  GOOGLE_REDIRECT_URI: optionalStr,

  GITHUB_APP_ID: optionalStr,
  GITHUB_APP_PRIVATE_KEY: optionalStr,
  GITHUB_WEBHOOK_SECRET: optionalStr,
  GITHUB_CLIENT_ID: optionalStr,
  GITHUB_CLIENT_SECRET: optionalStr,
  GITHUB_REDIRECT_URI: optionalStr,

  NOTION_CLIENT_ID: optionalStr,
  NOTION_CLIENT_SECRET: optionalStr,
  NOTION_REDIRECT_URI: optionalStr,

  /**
   * Pipedream Connect. One project serves every workspace; users are separated
   * by the external-user id sent per request, so there is nothing per-tenant to
   * configure here.
   */
  PIPEDREAM_PROJECT_ID: optionalStr,
  PIPEDREAM_ENVIRONMENT: z.enum(['development', 'production']).default('development'),
  PIPEDREAM_CLIENT_ID: optionalStr,
  PIPEDREAM_CLIENT_SECRET: optionalStr,

  MCP_AUTH_MODE: z.enum(['local', 'oauth']).default('local'),
  /** Development-only bearer token for the local MCP endpoint. */
  CAIRN_MCP_LOCAL_TOKEN: optionalStr,
  MCP_OAUTH_ISSUER: optionalStr,
  MCP_OAUTH_JWKS_URL: optionalStr,
  MCP_OAUTH_AUDIENCE: optionalStr,

  SENTRY_DSN: optionalStr,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalStr,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Soft limit warns in the UI; hard limit refuses metered AI work. */
  CAIRN_AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  CAIRN_AI_SOFT_LIMIT_RATIO: z.coerce.number().min(0).max(1).default(0.8),
  CAIRN_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  /** Ceiling on characters sent to a model in one extraction request. */
  CAIRN_MAX_EXTRACTION_CHARS: z.coerce.number().int().positive().default(24_000),

  /** Allow http:// and private-range URL imports. Off outside tests: SSRF guard. */
  CAIRN_ALLOW_INSECURE_URL_IMPORT: bool(false),
});

export type RawEnv = z.infer<typeof envSchema>;

export type ProviderStatus =
  | { readonly state: 'ready'; readonly detail: string }
  | { readonly state: 'demo'; readonly detail: string }
  | { readonly state: 'setup-required'; readonly detail: string; readonly missing: string[] };

export interface AppConfig {
  readonly env: RawEnv;
  readonly mode: 'demo' | 'cloud';
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly appUrl: string;
  readonly dataDir: string;
  readonly database: { readonly driver: 'pglite' | 'postgres'; readonly url?: string };
  /** True when the web process drains the job queue instead of a worker. */
  readonly inlineJobs: boolean;
  readonly providers: {
    readonly auth: ProviderStatus;
    readonly ai: ProviderStatus;
    readonly storage: ProviderStatus;
    readonly queue: ProviderStatus;
    readonly googleDrive: ProviderStatus;
    readonly github: ProviderStatus;
    readonly notion: ProviderStatus;
    readonly pipedream: ProviderStatus;
    readonly mcpAuth: ProviderStatus;
    readonly observability: ProviderStatus;
  };
}

function require_(values: Record<string, unknown>): string[] {
  return Object.entries(values)
    .filter(([, v]) => v === undefined || v === null || v === '')
    .map(([k]) => k);
}

function status(
  configured: boolean,
  missing: string[],
  readyDetail: string,
  demoDetail: string,
  forceDemo = false,
): ProviderStatus {
  if (configured && !forceDemo) return { state: 'ready', detail: readyDetail };
  if (missing.length === 0) return { state: 'demo', detail: demoDetail };
  return { state: 'setup-required', detail: demoDetail, missing };
}

/**
 * Resolves the local data directory to an absolute path.
 *
 * The website runs with its own working directory inside the workspace while the
 * CLIs run from the repository root. A relative path would therefore point at two
 * different databases — which looks exactly like "my data disappeared".
 */
function resolveDataDir(configured: string): string {
  if (path.isAbsolute(configured)) return configured;
  const cwd = process.cwd();
  // Walk up to the workspace root so every process agrees on one location.
  let dir = cwd;
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return path.join(dir, configured);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(cwd, configured);
}

export function buildConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
  }
  const env = parsed.data;

  const workosMissing = require_({
    WORKOS_API_KEY: env.WORKOS_API_KEY,
    WORKOS_CLIENT_ID: env.WORKOS_CLIENT_ID,
    WORKOS_REDIRECT_URI: env.WORKOS_REDIRECT_URI,
    CAIRN_SESSION_SECRET: env.CAIRN_SESSION_SECRET,
  });
  const googleMissing = require_({
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
  });
  const githubMissing = require_({
    GITHUB_APP_ID: env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
  });
  const notionMissing = require_({
    NOTION_CLIENT_ID: env.NOTION_CLIENT_ID,
    NOTION_CLIENT_SECRET: env.NOTION_CLIENT_SECRET,
    NOTION_REDIRECT_URI: env.NOTION_REDIRECT_URI,
  });
  const pipedreamMissing = require_({
    PIPEDREAM_PROJECT_ID: env.PIPEDREAM_PROJECT_ID,
    PIPEDREAM_CLIENT_ID: env.PIPEDREAM_CLIENT_ID,
    PIPEDREAM_CLIENT_SECRET: env.PIPEDREAM_CLIENT_SECRET,
  });
  const supabaseMissing = require_({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const openaiMissing = require_({ OPENAI_API_KEY: env.OPENAI_API_KEY });
  const localAiMissing = require_({ LOCAL_AI_BASE_URL: env.LOCAL_AI_BASE_URL });
  // Cairn issues its own MCP access tokens, so `oauth` mode needs no external
  // issuer configured. The three `MCP_OAUTH_*` variables now describe an
  // optional *additional* issuer to accept tokens from; requiring them here
  // would report a correctly configured deployment as broken.
  const oauthMcpMissing = env.MCP_OAUTH_ISSUER
    ? require_({
        MCP_OAUTH_JWKS_URL: env.MCP_OAUTH_JWKS_URL,
        MCP_OAUTH_AUDIENCE: env.MCP_OAUTH_AUDIENCE,
      })
    : [];

  const aiStatus: ProviderStatus =
    env.AI_PROVIDER === 'openai'
      ? status(
          openaiMissing.length === 0,
          openaiMissing,
          `OpenAI (${env.OPENAI_EXTRACTION_MODEL} + ${env.OPENAI_EMBEDDING_MODEL}), store:false`,
          'Deterministic built-in extractor and embeddings. No text leaves this machine.',
        )
      : env.AI_PROVIDER === 'local'
        ? status(
            localAiMissing.length === 0,
            localAiMissing,
            `Local OpenAI-compatible endpoint at ${env.LOCAL_AI_BASE_URL}`,
            'Deterministic built-in extractor and embeddings. No text leaves this machine.',
          )
        : {
            state: 'demo',
            detail: 'Deterministic built-in extractor and embeddings. No text leaves this machine.',
          };

  return {
    env,
    mode: env.CAIRN_MODE,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    appUrl: env.CAIRN_APP_URL.replace(/\/+$/, ''),
    dataDir: resolveDataDir(env.CAIRN_LOCAL_DATA_DIR),
    inlineJobs:
      env.CAIRN_INLINE_JOBS === 'always'
        ? true
        : env.CAIRN_INLINE_JOBS === 'never'
          ? false
          : // `auto`: only the local single-process database needs it.
            !env.DATABASE_URL,
    database: env.DATABASE_URL
      ? { driver: 'postgres', url: env.DATABASE_URL }
      : { driver: 'pglite' },
    providers: {
      auth:
        env.AUTH_PROVIDER === 'workos'
          ? status(
              workosMissing.length === 0,
              workosMissing,
              'WorkOS AuthKit (email code + Google)',
              'Local sign-in: an emailed code is written to the server log instead of being sent.',
            )
          : {
              state: 'demo',
              detail:
                'Local sign-in: an emailed code is written to the server log instead of being sent.',
            },
      ai: aiStatus,
      storage:
        env.STORAGE_PROVIDER === 'supabase'
          ? status(
              supabaseMissing.length === 0,
              supabaseMissing,
              `Supabase Storage bucket "${env.SUPABASE_STORAGE_BUCKET}"`,
              'Encrypted source snapshots are stored in the local database.',
            )
          : {
              state: 'demo',
              detail: 'Encrypted source snapshots are stored in the local database.',
            },
      queue:
        env.QUEUE_PROVIDER === 'supabase'
          ? status(
              supabaseMissing.length === 0,
              supabaseMissing,
              'Supabase Queues (pgmq)',
              'Durable Postgres job table consumed by the local worker.',
            )
          : {
              state: 'ready',
              detail: 'Durable Postgres job table consumed by the worker process.',
            },
      googleDrive: status(
        googleMissing.length === 0,
        googleMissing,
        'Google Drive, read-only',
        'Google Drive needs setup before it can be connected.',
      ),
      github: status(
        githubMissing.length === 0,
        githubMissing,
        'GitHub App, read-only (optional mirror)',
        'GitHub needs setup before it can be connected.',
      ),
      notion: status(
        notionMissing.length === 0,
        notionMissing,
        'Notion, read-only (shared pages only)',
        'Notion needs setup before it can be connected.',
      ),
      pipedream: status(
        pipedreamMissing.length === 0,
        pipedreamMissing,
        'Pipedream Connect, read-only (one project, scoped per user)',
        'Pipedream needs setup before its apps can be connected.',
      ),
      mcpAuth:
        env.MCP_AUTH_MODE === 'oauth'
          ? status(
              oauthMcpMissing.length === 0,
              oauthMcpMissing,
              env.MCP_OAUTH_ISSUER
                ? 'OAuth 2.1, tokens issued here and accepted from the configured issuer'
                : 'OAuth 2.1, tokens issued and verified here',
              'Local connection code. Only works from this computer.',
            )
          : {
              state: 'demo',
              detail: 'Local connection code. Only works from this computer.',
            },
      observability: env.SENTRY_DSN
        ? { state: 'ready', detail: 'Sentry error reporting enabled' }
        : { state: 'demo', detail: 'Structured logs only; no external error reporting.' },
    },
  };
}

let cached: AppConfig | undefined;

/** Process-wide configuration. Call `resetConfig()` in tests after mutating env. */
export function getConfig(): AppConfig {
  cached ??= buildConfig();
  return cached;
}

export function resetConfig(): void {
  cached = undefined;
}
