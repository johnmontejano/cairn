import { type AppConfig, getConfig } from '@cairn/config';
import {
  DatabaseObjectStore,
  type DbHandle,
  Keyring,
  PostgresQueue,
  PostgresRateLimiter,
  SupabaseObjectStore,
  getDb,
} from '@cairn/db';
import type {
  Embedder,
  ErrorReporter,
  Logger,
  MemoryExtractor,
  ObjectStore,
  QueueAdapter,
  RateLimiter,
} from '@cairn/domain';
import { type Answerer, createAnswerer, createEmbedder } from '@cairn/search';
import { PostgresMemoryVault } from '@cairn/vault';
import { createExtractor } from './extract';
import { createErrorReporter, createLogger } from './observability';

/**
 * The composition root.
 *
 * Both the website and the worker build the same object, so a rule enforced in
 * one is enforced in the other. Which concrete adapter each port resolves to is
 * decided here and nowhere else — that is what makes "swap Supabase for a local
 * database" or "swap OpenAI for a local model" a configuration change.
 */
export interface CairnServices {
  config: AppConfig;
  handle: DbHandle;
  keyring: Keyring;
  /**
   * The concrete vault, not the port. Callers that are already inside a
   * transaction need `commitWithin`, and hiding that behind the narrower
   * interface only moved the cast somewhere less visible.
   */
  vault: PostgresMemoryVault;
  queue: QueueAdapter;
  embedder: Embedder;
  extractor: MemoryExtractor;
  answerer: Answerer;
  logger: Logger;
  errors: ErrorReporter;
  rateLimiter: RateLimiter;
  objectStore(workspaceId: string): ObjectStore;
}

let cached: Promise<CairnServices> | undefined;

export async function createServices(options?: {
  handle?: DbHandle;
  config?: AppConfig;
}): Promise<CairnServices> {
  const config = options?.config ?? getConfig();
  const handle = options?.handle ?? (await getDb());
  const keyring = new Keyring(handle);

  return {
    config,
    handle,
    keyring,
    vault: new PostgresMemoryVault(handle, keyring),
    queue: new PostgresQueue(handle),
    embedder: createEmbedder(config),
    extractor: createExtractor(config),
    answerer: createAnswerer(config),
    logger: createLogger(config),
    errors: createErrorReporter(config),
    rateLimiter: new PostgresRateLimiter(handle),
    objectStore(workspaceId: string): ObjectStore {
      const { env } = config;
      if (
        env.STORAGE_PROVIDER === 'supabase' &&
        env.SUPABASE_URL &&
        env.SUPABASE_SERVICE_ROLE_KEY
      ) {
        return new SupabaseObjectStore(
          {
            url: env.SUPABASE_URL,
            serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
            bucket: env.SUPABASE_STORAGE_BUCKET,
          },
          workspaceId,
        );
      }
      return new DatabaseObjectStore(handle, workspaceId);
    },
  };
}

/** Process-wide services. Tests build their own with `createServices({handle})`. */
export function getServices(): Promise<CairnServices> {
  cached ??= createServices();
  return cached;
}

export function resetServices(): void {
  cached = undefined;
}
