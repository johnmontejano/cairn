#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * One-command local setup.
 *
 * Generates the development master key, writes `.env.local`, and creates the
 * local database. It refuses to overwrite an existing key, because doing so would
 * make every previously encrypted row permanently unreadable.
 */

const root = process.cwd();
const envPath = path.join(root, '.env.local');
const dataDir = path.join(root, '.cairn');

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

let contents = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const hasKey = /^CAIRN_MASTER_KEY=.+$/m.test(contents);

if (hasKey) {
  process.stdout.write('Keeping the existing CAIRN_MASTER_KEY in .env.local.\n');
} else {
  const key = randomBytes(32).toString('base64');
  const block = [
    '# Written by `pnpm setup`. Local development only.',
    '#',
    '# This key encrypts every workspace key in the local database. If you lose it,',
    '# the data encrypted under it cannot be recovered. Never commit this file.',
    `CAIRN_MASTER_KEY=${key}`,
    'CAIRN_MODE=demo',
    'CAIRN_APP_URL=http://localhost:3000',
    `CAIRN_LOCAL_DATA_DIR=${dataDir}`,
    'AUTH_PROVIDER=fixture',
    'AI_PROVIDER=fixture',
    'STORAGE_PROVIDER=local',
    'QUEUE_PROVIDER=postgres',
    'MCP_AUTH_MODE=local',
    'LOG_LEVEL=info',
    '',
  ].join('\n');
  contents = contents.length > 0 ? `${contents.trimEnd()}\n\n${block}` : block;
  writeFileSync(envPath, contents, { mode: 0o600 });
  process.stdout.write('Created .env.local with a fresh development key.\n');
}

process.stdout.write('\nCreating the local database...\n');
const migration = spawnSync('node', ['--import', 'tsx', 'packages/db/src/cli/migrate.ts'], {
  stdio: 'inherit',
  shell: false,
});
if (migration.status !== 0) {
  process.stderr.write(
    '\nThe database could not be created. Fix the error above and run `pnpm db:migrate`.\n',
  );
  process.exit(1);
}

process.stdout.write(
  '\nReady.\n' +
    '  pnpm demo:seed   # optional: fill it with an example project\n' +
    '  pnpm dev         # start the website on http://localhost:3000\n\n' +
    'Sign in with any email address. The code is printed here, not emailed.\n\n',
);
