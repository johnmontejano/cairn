import { sql } from 'drizzle-orm';
import type { RateLimiter } from '@cairn/domain';
import type { DbHandle } from '../client';
import { withSystem } from '../tenancy';
import { normalizeRows } from '../rows';

/**
 * Fixed-window rate limiting in Postgres.
 *
 * One statement, one round trip, and correct under concurrency because the
 * increment and the window reset happen inside the same upsert. Good enough for a
 * single-region deployment; a multi-region one should move this to a shared cache
 * behind the same interface.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly handle: DbHandle) {}

  async check(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const seconds = Math.ceil(windowMs / 1000);
    return withSystem(this.handle, async (tx) => {
      const result = await tx.execute(sql`
        INSERT INTO rate_limits (key, window_start, count)
        VALUES (${key}, now(), 1)
        ON CONFLICT (key) DO UPDATE SET
          window_start = CASE
            WHEN rate_limits.window_start < now() - (${seconds} || ' seconds')::interval
            THEN now() ELSE rate_limits.window_start END,
          count = CASE
            WHEN rate_limits.window_start < now() - (${seconds} || ' seconds')::interval
            THEN 1 ELSE rate_limits.count + 1 END
        RETURNING count, extract(epoch from (window_start + (${seconds} || ' seconds')::interval - now()))::int AS retry_after
      `);
      const row = normalizeRows<{ count: number; retry_after: number }>(result)[0];
      const count = Number(row?.count ?? 1);
      return {
        allowed: count <= limit,
        retryAfterSeconds: Math.max(1, Number(row?.retry_after ?? seconds)),
      };
    });
  }
}

/** Always allows. Used where a limiter is structurally required but not wanted. */
export const noopRateLimiter: RateLimiter = {
  async check() {
    return { allowed: true, retryAfterSeconds: 0 };
  },
};
