/**
 * Driver-shape normalisation.
 *
 * PGlite returns `{ rows }` from a raw query while postgres.js returns an array.
 * Every raw-SQL call site goes through here so neither driver leaks its shape
 * into the rest of the code.
 */
export function normalizeRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
