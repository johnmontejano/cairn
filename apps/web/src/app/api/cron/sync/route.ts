import { enqueueScheduledSyncs, getServices } from '@cairn/ingestion';
import { drainQueuedWork } from '@/server/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Vercel's Hobby plan caps a function at 60s. Draining is best-effort per run
// and the queue survives being cut off mid-flight, so this is a ceiling rather
// than a budget the work is expected to fill.
export const maxDuration = 60;

/**
 * The scheduler's entry point.
 *
 * All this owns is deciding whether the caller is allowed; the work itself is
 * `enqueueScheduledSyncs`, which lives in the ingestion package so it can be
 * tested against a real database without a web server.
 */

/**
 * Bearer check against `CRON_SECRET`.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that variable is
 * set on the project. The comparison is length-checked first and then run over
 * the whole string, so it does not leak the secret through timing. Refusing
 * when the variable is unset is deliberate: an unauthenticated endpoint that
 * enqueues work for every tenant is worse than one that never runs.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (presented.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    // No detail: a caller without the secret learns only that it was refused,
    // not whether the variable is configured.
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const services = await getServices();
  const log = services.logger.child({ component: 'cron.sync' });
  const result = await enqueueScheduledSyncs(services);

  // Best-effort. Whatever is not drained here stays queued and is picked up by
  // the next run or by a worker, so a timeout costs latency and never work. A
  // no-op when a separate worker owns draining, which is why it is reported
  // rather than assumed.
  let drained = false;
  try {
    await drainQueuedWork(services);
    drained = services.config.inlineJobs;
  } catch (error) {
    log.error('cron.sync.drain_failed', { error });
    services.errors.captureException(error, { component: 'cron.sync' });
  }

  const body = { ok: true, ...result, drained, durationMs: Date.now() - started };
  log.info('cron.sync.finished', body);
  return Response.json(body);
}
