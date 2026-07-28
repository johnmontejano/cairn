import { describe, expect, it } from 'vitest';
import { normalizeRows } from '@cairn/db';

/**
 * The two drivers disagree about what a raw query returns: PGlite gives
 * `{ rows }`, postgres.js gives an array. Reading one shape as the other does
 * not throw — it silently yields nothing, so a count check quietly reports zero
 * and a safeguard built on it never fires. That is exactly how the stale-job
 * check in /api/health shipped broken, so the helper is pinned here.
 */
describe('normalizing raw query results', () => {
  it('reads the array shape postgres.js returns', () => {
    expect(normalizeRows<{ n: number }>([{ n: 7 }])).toEqual([{ n: 7 }]);
  });

  it('reads the { rows } shape PGlite returns', () => {
    const pglite = { rows: [{ n: 7 }], fields: [], affectedRows: 0 };
    expect(normalizeRows<{ n: number }>(pglite)).toEqual([{ n: 7 }]);
  });

  it('gives the same answer for both, which is the entire point', () => {
    const fromArray = normalizeRows<{ stale: number }>([{ stale: 3 }]);
    const fromRows = normalizeRows<{ stale: number }>({ rows: [{ stale: 3 }] });
    expect(fromArray[0]?.stale).toBe(3);
    expect(fromRows[0]?.stale).toBe(3);
  });

  it('indexing the PGlite shape directly yields nothing — the original bug', () => {
    const pglite = { rows: [{ stale: 3 }] } as unknown as Array<{ stale: number }>;
    expect(pglite[0]?.stale).toBeUndefined();
    expect(Number(pglite[0]?.stale ?? 0)).toBe(0);
  });

  it('treats an empty or unexpected result as no rows rather than throwing', () => {
    expect(normalizeRows(null)).toEqual([]);
    expect(normalizeRows(undefined)).toEqual([]);
    expect(normalizeRows({ affectedRows: 0 })).toEqual([]);
  });
});
