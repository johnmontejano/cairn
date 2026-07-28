import { sql } from 'drizzle-orm';
import { PRODUCT } from '@cairn/config';
import { normalizeRows } from '@cairn/db';
import { getServices } from '@cairn/ingestion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness and readiness in one document.
 *
 * Deliberately reports per-dependency state rather than a bare 200, because "the
 * web process is up but the queue is not draining" is the failure that actually
 * happens. Nothing here reveals configuration values — only whether each piece is
 * usable.
 */
export async function GET(): Promise<Response> {
  const started = Date.now();
  const services = await getServices();
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  checks.database = await check(async () => {
    await services.handle.db.execute(sql`SELECT 1`);
    return services.handle.driver === 'pglite' ? 'Local PostgreSQL (PGlite)' : 'PostgreSQL';
  });

  checks.queue = await check(async () => {
    await services.handle.db.execute(sql`SELECT count(*) FROM jobs WHERE state = 'queued'`);
    return `${services.queue.kind} queue reachable`;
  });

  // The failure this is here to catch: a deployment that expects a worker and
  // does not have one. Nothing else notices — uploads simply never finish.
  checks.jobs = await check(async () => {
    const how = services.config.inlineJobs
      ? 'drained by the web process'
      : 'drained by a separate worker';
    if (services.config.inlineJobs) return how;
    const result = await services.handle.db.execute(
      sql`SELECT count(*)::int AS stale FROM jobs
          WHERE state = 'queued' AND run_at < now() - interval '5 minutes'`,
    );
    const stale = Number(normalizeRows<{ stale: number }>(result)[0]?.stale ?? 0);
    if (stale > 0) {
      throw new Error(
        `${stale} job(s) queued for over five minutes. Is the worker running? Set CAIRN_INLINE_JOBS=always to run them in the web process instead.`,
      );
    }
    return how;
  });

  checks.storage = await check(async () => {
    await services.handle.db.execute(sql`SELECT 1 FROM stored_objects LIMIT 1`);
    return services.config.providers.storage.detail;
  });

  checks.vault = { ok: true, detail: 'Versioned Markdown vault' };
  checks.mcp = {
    ok: true,
    detail: `${services.config.env.MCP_AUTH_MODE} authorization`,
  };
  checks.ai = { ok: true, detail: services.config.providers.ai.detail };

  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json(
    {
      product: PRODUCT.name,
      status: ok ? 'ok' : 'degraded',
      mode: services.config.mode,
      checks,
      durationMs: Date.now() - started,
    },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}

async function check(run: () => Promise<string>): Promise<{ ok: boolean; detail: string }> {
  try {
    return { ok: true, detail: await run() };
  } catch (error) {
    const message = `${(error as Error).message} ${(error as { cause?: Error }).cause?.message ?? ''}`;
    // A missing table means the database exists but has never been migrated —
    // a setup step, not a fault, and worth saying so precisely.
    if (/does not exist|undefined_table|relation .* does not exist/i.test(message)) {
      return { ok: false, detail: 'Not set up yet — run `pnpm db:migrate`.' };
    }
    return { ok: false, detail: message.slice(0, 200) };
  }
}
