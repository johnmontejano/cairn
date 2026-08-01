import type {
  ActorContext,
  AuditAction,
  Job,
  JobType,
  MemoryCandidate,
  SourceProvider,
  Uuid,
  VaultCommitChange,
  VaultManifest,
  VaultProvenance,
  VaultVersion,
} from './types';

/**
 * Ports. Every external dependency the product has is expressed here so the
 * domain never imports Supabase, WorkOS, OpenAI, GitHub, or the filesystem.
 * Each port has at least one production adapter and one fixture adapter.
 */

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): Uuid;
}

/* ------------------------------- vault --------------------------------- */

export interface MemoryVault {
  /** Appends an immutable version. Never mutates an existing one. */
  commit(input: {
    actor: ActorContext;
    projectId: Uuid;
    changes: VaultCommitChange[];
    reason: string;
    authorLabel: string;
    provenance: VaultProvenance;
  }): Promise<VaultVersion>;

  read(input: {
    actor: ActorContext;
    projectId: Uuid;
    path: string;
    versionId?: Uuid;
  }): Promise<string | null>;

  list(input: { actor: ActorContext; projectId: Uuid; versionId?: Uuid }): Promise<VaultManifest>;

  history(input: { actor: ActorContext; projectId: Uuid; limit?: number }): Promise<VaultVersion[]>;

  head(input: { actor: ActorContext; projectId: Uuid }): Promise<VaultVersion | null>;

  getVersion(input: { actor: ActorContext; versionId: Uuid }): Promise<VaultVersion | null>;

  /** Recomputes hashes from stored bytes; the basis of restore verification. */
  verify(input: {
    actor: ActorContext;
    projectId: Uuid;
    versionId?: Uuid;
  }): Promise<{ ok: boolean; checked: number; problems: string[] }>;
}

/* ------------------------------ storage -------------------------------- */

export interface ObjectStore {
  readonly kind: 'database' | 'supabase';
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
}

/* ------------------------------- queue --------------------------------- */

export interface EnqueueInput {
  workspaceId: Uuid;
  projectId?: Uuid | null;
  type: JobType;
  /** Duplicate keys collapse to a single job: the basis of replay safety. */
  idempotencyKey: string;
  payload: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}

export interface QueueAdapter {
  readonly kind: 'postgres' | 'supabase';
  enqueue(input: EnqueueInput): Promise<{ job: Job; deduplicated: boolean }>;
  /** Atomically claims up to `limit` due jobs, marking them running. */
  claim(limit: number, now?: Date): Promise<Job[]>;
  complete(jobId: Uuid, durationMs: number): Promise<void>;
  fail(
    jobId: Uuid,
    error: { category: string; message: string },
    retryInMs: number | null,
  ): Promise<void>;
}

/* ---------------------------- authentication --------------------------- */

export interface AuthStartResult {
  kind: 'email_code' | 'redirect';
  /** Present for `redirect` (OAuth). */
  url?: string;
  /** Present for `email_code` in demo mode only, so the dev UI can show it. */
  devCode?: string;
  challengeId: string;
}

export interface AuthProvider {
  readonly kind: 'fixture' | 'workos';
  readonly status: 'ready' | 'demo' | 'setup-required';
  startEmailSignIn(email: string): Promise<AuthStartResult>;
  completeEmailSignIn(
    challengeId: string,
    code: string,
  ): Promise<{ email: string; externalId: string; displayName: string | null }>;
  startGoogleSignIn(state: string): Promise<AuthStartResult>;
  /**
   * `state` is not a parameter here: it is validated against a short-lived
   * cookie set right before the redirect (see `OAUTH_STATE_COOKIE`), by the
   * caller, before this is ever invoked — a provider has nothing to check it
   * against.
   */
  completeOAuth(
    code: string,
  ): Promise<{ email: string; externalId: string; displayName: string | null }>;
}

/* --------------------------------- AI ---------------------------------- */

export interface ExtractionRequest {
  text: string;
  sourceTitle: string;
  provider: SourceProvider;
  projectName: string;
  /** Hash of `text`; adapters use it to cache and to avoid reprocessing. */
  contentHash: string;
}

export interface ExtractionUsage {
  model: string;
  promptVersion: string;
  schemaVersion: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  cached: boolean;
}

export interface MemoryExtractor {
  readonly kind: 'fixture' | 'openai' | 'local';
  readonly modelLabel: string;
  extract(
    request: ExtractionRequest,
  ): Promise<{ candidates: MemoryCandidate[]; usage: ExtractionUsage }>;
}

export interface EmbeddingUsage {
  model: string;
  inputTokens: number;
  estimatedCostUsd: number;
  cached: boolean;
}

export interface Embedder {
  readonly kind: 'fixture' | 'openai' | 'local';
  readonly modelLabel: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<{ vectors: number[][]; usage: EmbeddingUsage }>;
}

/* ------------------------------ connectors ----------------------------- */

export interface FetchedSource {
  externalId: string;
  title: string;
  mimeType: string;
  canonicalUri: string | null;
  externalRevision: string | null;
  /** Raw bytes exactly as received; stored encrypted and never re-fetched for citations. */
  bytes: Uint8Array;
}

export interface SourceConnector {
  readonly provider: SourceProvider;
  readonly displayName: string;
  /** What this connector reads, in ordinary language, shown before connecting. */
  readonly permissionSummary: string;
  readonly readOnly: true;
  status(): 'ready' | 'demo' | 'setup-required';
  /** Lists items the connection can see. Fixture connectors return canned data. */
  list(input: { connectionId: Uuid; cursor: string | null; credential: string | null }): Promise<{
    items: FetchedSource[];
    nextCursor: string | null;
  }>;
}

/* ------------------------------ audit/log ------------------------------ */

export interface AuditSink {
  record(event: {
    workspaceId: Uuid;
    actorUserId?: Uuid | null;
    actorClientId?: Uuid | null;
    action: AuditAction;
    subjectType?: string | null;
    subjectId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ErrorReporter {
  readonly kind: 'noop' | 'sentry';
  captureException(error: unknown, context?: Record<string, unknown>): void;
}

export interface RateLimiter {
  /** Returns false when the caller should be refused. */
  check(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}
