#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

/**
 * The full gate.
 *
 * Runs every check in the order that fails fastest and cheapest first, and always
 * prints a summary — a run that stops at the first failure hides how much else is
 * broken.
 */
const steps = [
  ['format', ['pnpm', 'format:check']],
  ['lint', ['pnpm', 'lint']],
  ['typecheck', ['pnpm', 'typecheck']],
  ['unit tests', ['pnpm', 'test']],
  ['integration + security tests', ['pnpm', 'test:integration']],
  ['security contract tests', ['pnpm', 'test:security']],
  ['MCP contract tests', ['pnpm', 'test:mcp']],
  ['production build', ['pnpm', 'build']],
];

const results = [];
for (const [label, command] of steps) {
  process.stdout.write(`\n[1m▸ ${label}[0m\n`);
  const started = Date.now();
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: false });
  results.push({
    label,
    ok: result.status === 0,
    seconds: Math.round((Date.now() - started) / 1000),
  });
}

process.stdout.write('\n[1mSummary[0m\n');
for (const result of results) {
  process.stdout.write(`  ${result.ok ? '✓' : '✗'} ${result.label} (${result.seconds}s)\n`);
}
const failures = results.filter((r) => !r.ok);
process.stdout.write(
  failures.length === 0 ? '\nAll checks passed.\n' : `\n${failures.length} check(s) failed.\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
