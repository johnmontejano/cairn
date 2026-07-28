export * from './types';
export * from './errors';
export * from './policy';
export * from './ports';
export * from './markdown';

import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from './ports';

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { uuid: () => randomUUID() };

/** Deterministic clock/ids for tests, so version hashes are reproducible. */
export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export function sequentialIds(prefixSeed = 0): IdGenerator {
  let n = prefixSeed;
  return {
    uuid: () => {
      n += 1;
      const hex = n.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${hex}`;
    },
  };
}
