import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector as pgliteVector } from '@electric-sql/pglite/vector';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { getConfig } from '@cairn/config';
import * as schema from './schema';

export type CairnDb = PgDatabase<PgQueryResultHKT, typeof schema>;
export type CairnTx = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
/** Anything that can run a query: the pool or a transaction inside `withTenant`. */
export type Queryable = CairnDb | CairnTx;

export interface DbHandle {
  readonly driver: 'pglite' | 'postgres';
  readonly db: CairnDb;
  /** Runs a multi-statement SQL script. Used only by the migration runner. */
  raw(sqlText: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens a database.
 *
 * With `DATABASE_URL` set this is ordinary Postgres (Supabase in the documented
 * deployment). Without it, PGlite runs a real PostgreSQL build in-process, so
 * local development and tests exercise the same SQL — including row-level
 * security and pgvector — with no Docker daemon or hosted account.
 */
export async function openDatabase(options?: {
  url?: string;
  /** `:memory:` gives each test file an isolated database. */
  dataDir?: string;
}): Promise<DbHandle> {
  const config = getConfig();
  const url = options?.url ?? config.env.DATABASE_URL;

  if (url) {
    const client = postgres(url, {
      max: 10,
      ssl: config.env.DATABASE_SSL && !url.includes('localhost') ? 'require' : undefined,
      // Timestamps are compared and stored as UTC everywhere.
      transform: undefined,
      onnotice: () => {},
    });
    const db = drizzlePostgres(client, { schema }) as unknown as CairnDb;
    return {
      driver: 'postgres',
      db,
      raw: async (sqlText) => {
        await client.unsafe(sqlText).simple();
      },
      close: async () => {
        await client.end({ timeout: 5 });
      },
    };
  }

  const dataDir = options?.dataDir ?? path.join(config.dataDir, 'pgdata');
  if (dataDir !== ':memory:' && !dataDir.startsWith('memory://')) {
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite(dataDir === ':memory:' ? 'memory://' : dataDir, {
    extensions: { vector: pgliteVector },
  });
  await client.waitReady;
  const db = drizzlePglite(client, { schema }) as unknown as CairnDb;
  return {
    driver: 'pglite',
    db,
    raw: async (sqlText) => {
      await client.exec(sqlText);
    },
    close: async () => {
      await client.close();
    },
  };
}

/**
 * The handle is pinned to the global scope, not to this module.
 *
 * A bundler can hand the same module to several server chunks — pages and route
 * handlers, for instance — each with its own copy of module-level state. Against
 * a pooled PostgreSQL that is merely wasteful; against the local single-process
 * database it means two instances over one directory, and a session written by
 * one is invisible to the other. Sharing through `globalThis` gives every chunk
 * the same connection.
 */
const HANDLE_KEY = Symbol.for('cairn.db.handle');

type GlobalWithHandle = typeof globalThis & { [HANDLE_KEY]?: Promise<DbHandle> };

/** Process-wide handle used by the web app and worker. */
export function getDb(): Promise<DbHandle> {
  const scope = globalThis as GlobalWithHandle;
  scope[HANDLE_KEY] ??= openDatabase();
  return scope[HANDLE_KEY];
}

export async function closeDb(): Promise<void> {
  const scope = globalThis as GlobalWithHandle;
  const pending = scope[HANDLE_KEY];
  if (!pending) return;
  delete scope[HANDLE_KEY];
  await (await pending).close();
}

export { schema };
