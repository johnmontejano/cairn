#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

/**
 * Typechecks the packages and the website separately: the website needs JSX and
 * Next's plugin, everything else must typecheck without them.
 */
const runs = [
  { label: 'packages + worker', args: ['tsc', '--noEmit', '-p', 'tsconfig.json'] },
  { label: 'website', args: ['tsc', '--noEmit', '-p', 'apps/web/tsconfig.json'] },
];

let failed = false;
for (const run of runs) {
  process.stdout.write(`\n▸ typecheck: ${run.label}\n`);
  const result = spawnSync('npx', run.args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
