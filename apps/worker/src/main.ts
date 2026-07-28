import { loadEnvFiles } from '@cairn/config';
import { migrate } from '@cairn/db/migrate';
import { createServices, processDueJobs } from '@cairn/ingestion';

loadEnvFiles();

/**
 * The worker process.
 *
 * Ingestion never runs inside a page request, an OAuth callback, or a webhook
 * response — those have to answer in milliseconds, and reading a document does
 * not. This process claims jobs through the same queue the website enqueues to,
 * so both can run, neither is required, and scaling out means starting another
 * copy.
 */

const POLL_INTERVAL_MS = Number(process.env.CAIRN_WORKER_POLL_MS ?? 1000);
const BATCH_SIZE = Number(process.env.CAIRN_WORKER_BATCH ?? 5);

const services = await createServices();
const log = services.logger.child({ component: 'worker' });

if (services.config.database.driver === 'pglite') {
  // PGlite is an in-process database file. Two processes cannot hold it at once,
  // and silently corrupting someone's demo data is not an acceptable way to find
  // that out.
  log.error('worker.local_database', {
    message:
      'DATABASE_URL is not set, so this project is using the local single-process database. ' +
      'In that mode the website runs jobs itself and this worker is not needed. ' +
      'Set DATABASE_URL to a PostgreSQL instance to run the worker separately.',
  });
  process.exit(1);
}

await migrate(services.handle, { silent: true });
log.info('worker.started', { pollIntervalMs: POLL_INTERVAL_MS, batch: BATCH_SIZE });

let running = true;
let inFlight: Promise<unknown> = Promise.resolve();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!running) return;
    running = false;
    log.info('worker.stopping', { signal });
    // Let the current batch finish rather than abandoning half-done jobs; the
    // queue would recover either way, but finishing is cheaper than retrying.
    void inFlight.finally(async () => {
      await services.handle.close().catch(() => {});
      process.exit(0);
    });
  });
}

process.on('unhandledRejection', (reason) => {
  log.error('worker.unhandled_rejection', { error: reason });
  services.errors.captureException(reason, { component: 'worker' });
});

let idleRounds = 0;
while (running) {
  inFlight = processDueJobs(services, BATCH_SIZE);
  const result = (await inFlight) as { processed: number; failed: number };

  if (result.processed === 0 && result.failed === 0) {
    idleRounds += 1;
  } else {
    idleRounds = 0;
    log.info('worker.batch', result);
  }

  // Back off while idle so an idle deployment is not a busy poll loop.
  const delay = Math.min(POLL_INTERVAL_MS * Math.min(idleRounds + 1, 10), 15_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}
