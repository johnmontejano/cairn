import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { sha256Hex } from '@cairn/crypto';
import type { DbHandle } from './client';
import { normalizeRows } from './rows';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const body = readFileSync(path.join(dir, file), 'utf8');
      return {
        version: file.replace(/\.sql$/, ''),
        name: file,
        sql: body,
        checksum: sha256Hex(body),
      };
    });
}

/**
 * Applies pending migrations in order.
 *
 * Migrations are append-only: if an already-applied file's bytes change, this
 * stops rather than silently running a different schema than the one recorded.
 */
export async function migrate(
  handle: DbHandle,
  options?: { silent?: boolean },
): Promise<{
  applied: string[];
  skipped: string[];
}> {
  await handle.raw(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const existing = await handle.db.execute(sql`SELECT version, checksum FROM schema_migrations`);
  const rows = normalizeRows<{ version: string; checksum: string }>(existing);
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));

  const result = { applied: [] as string[], skipped: [] as string[] };
  for (const migration of loadMigrations()) {
    const previous = applied.get(migration.version);
    if (previous) {
      if (previous !== migration.checksum) {
        throw new Error(
          `Migration ${migration.name} was modified after it was applied. Migrations are append-only: add a new file instead.`,
        );
      }
      result.skipped.push(migration.version);
      continue;
    }
    if (!options?.silent) process.stdout.write(`  applying ${migration.name}\n`);
    await handle.raw(migration.sql);
    await handle.db.execute(
      sql`INSERT INTO schema_migrations (version, checksum) VALUES (${migration.version}, ${migration.checksum})`,
    );
    result.applied.push(migration.version);
  }
  return result;
}
