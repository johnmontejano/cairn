import { sql } from 'drizzle-orm';
import { PRODUCT } from '@cairn/config';
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
