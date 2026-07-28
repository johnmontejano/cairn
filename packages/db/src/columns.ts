import { customType } from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS } from '@cairn/config';

/** `bytea` normalized to `Uint8Array` regardless of driver (PGlite vs postgres.js). */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => (value instanceof Uint8Array ? value : Buffer.from(value as never)),
});

/** pgvector column. Both drivers exchange vectors as the textual `[1,2,3]` form. */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${EMBEDDING_DIMENSIONS})`,
  toDriver: (value) => `[${value.join(',')}]`,
  fromDriver: (value) =>
    typeof value === 'string' ? (JSON.parse(value) as number[]) : (value as unknown as number[]),
});
