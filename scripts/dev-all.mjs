#!/usr/bin/env node
import { spawn } from 'node:child_process';

/**
 * Starts the website, and the worker too when there is a real database for it to
 * share. Against the local single-process database the website runs jobs itself,
 * so starting a worker would only fight it for the file.
 */
const usingPostgres = Boolean(process.env.DATABASE_URL);
const children = [];

function start(name, args) {
  const child = spawn('pnpm', args, { stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    process.stdout.write(`\n${name} exited (${code}). Stopping everything.\n`);
    for (const other of children) if (other !== child) other.kill('SIGTERM');
    process.exit(code ?? 0);
  });
  children.push(child);
}

start('website', ['--filter', '@cairn/web', 'dev']);
if (usingPostgres) {
  start('worker', ['--filter', '@cairn/worker', 'dev']);
} else {
  process.stdout.write(
    'Using the local database, so the website will process background jobs itself.\n' +
      'Set DATABASE_URL to run the worker as a separate process.\n\n',
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
    process.exit(0);
  });
}
