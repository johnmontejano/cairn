#!/usr/bin/env node
import { getConfig, loadEnvFiles, PRODUCT } from '@cairn/config';

/**
 * Preflight for a deployment.
 *
 * The failure this exists to prevent: a deploy that builds cleanly, serves a
 * page, and is quietly broken — no worker draining the queue, storage pointing
 * nowhere, sign-in falling back to printing codes into a log nobody reads. Those
 * surface as "it doesn't work" hours later, if at all.
 *
 * Reuses the provider states the app already computes, so this cannot drift from
 * what the running process actually believes. It reports; it changes nothing.
 */

loadEnvFiles();

const config = getConfig();
const cloud = config.mode === 'cloud';

const TICK = '✓';
const DOT = '○';
const CROSS = '✗';

let problems = 0;
let warnings = 0;

const line = (mark: string, label: string, detail: string) =>
  process.stdout.write(`  ${mark} ${label.padEnd(16)} ${detail}\n`);

process.stdout.write(`\n${PRODUCT.name} preflight\n\n`);
process.stdout.write(`  Mode             ${config.mode}\n`);
process.stdout.write(`  Address          ${config.appUrl}\n`);
process.stdout.write(
  `  Database         ${config.database.driver === 'pglite' ? 'local, in this process' : 'PostgreSQL'}\n`,
);
process.stdout.write(
  `  Background work  ${config.inlineJobs ? 'done by the website itself' : 'needs a separate worker'}\n\n`,
);

// A cloud deployment that still points at the in-process database loses
// everything on redeploy. Nothing else reports this, because locally it is
// the correct setting.
if (cloud && config.database.driver === 'pglite') {
  problems += 1;
  line(CROSS, 'Database', 'Set DATABASE_URL. Without it, data is lost on every redeploy.');
}

// The single-user deployment this project targets runs no worker. If neither the
// worker nor inline draining is on, uploads are accepted and never finish.
if (cloud && !config.inlineJobs) {
  warnings += 1;
  line(
    DOT,
    'Background work',
    'No worker is deployed? Set CAIRN_INLINE_JOBS=always or uploads will never finish.',
  );
}

if (cloud && config.appUrl.startsWith('http://')) {
  problems += 1;
  line(CROSS, 'Address', 'CAIRN_APP_URL must be https:// — sign-in cookies are marked Secure.');
}

const LABELS: Record<string, string> = {
  auth: 'Sign-in',
  ai: 'Reading',
  storage: 'File storage',
  queue: 'Job queue',
  googleDrive: 'Google Drive',
  github: 'GitHub',
  mcpAuth: 'AI tool access',
  observability: 'Error reports',
};

// Connectors are opt-in: unconfigured is a normal state, not a fault, whether or
// not the deployment is a cloud one.
const OPTIONAL = new Set(['googleDrive', 'github', 'observability']);

process.stdout.write('  Providers\n');
for (const [key, label] of Object.entries(LABELS)) {
  const provider = config.providers[key as keyof typeof config.providers];
  if (provider.state === 'ready') {
    line(TICK, label, provider.detail);
    continue;
  }
  if (provider.state === 'demo') {
    line(DOT, label, provider.detail);
    continue;
  }
  const missing = provider.missing.join(', ');
  if (cloud && !OPTIONAL.has(key)) {
    problems += 1;
    line(CROSS, label, `Needs ${missing}`);
  } else {
    warnings += 1;
    line(DOT, label, `Not set up. Needs ${missing}`);
  }
}

process.stdout.write('\n');

if (problems > 0) {
  process.stdout.write(
    `${problems} thing(s) must be fixed before this deployment will work properly.\n` +
      `Each line marked ${CROSS} names the exact variable to set.\n\n`,
  );
  process.exit(1);
}

process.stdout.write(
  warnings > 0
    ? `Ready. ${warnings} optional thing(s) are not set up; each is safe to leave.\n\n`
    : 'Ready. Everything is configured.\n\n',
);
