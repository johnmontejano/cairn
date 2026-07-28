import { describe, expect, it } from 'vitest';
import { buildConfig } from '@cairn/config';

const base = { CAIRN_MASTER_KEY: Buffer.alloc(32).toString('base64') };

describe('who drains the job queue', () => {
  it('drains inline against the local database, where a worker cannot open it', () => {
    expect(buildConfig({ ...base } as never).inlineJobs).toBe(true);
  });

  it('expects a separate worker once a real database is configured', () => {
    const c = buildConfig({ ...base, DATABASE_URL: 'postgres://x/y' } as never);
    expect(c.inlineJobs).toBe(false);
    expect(c.database.driver).toBe('postgres');
  });

  it('lets a single-user deployment run with no worker at all', () => {
    const c = buildConfig({
      ...base,
      DATABASE_URL: 'postgres://x/y',
      CAIRN_INLINE_JOBS: 'always',
    } as never);
    expect(c.inlineJobs).toBe(true);
  });

  it('can be forced off, so a misconfigured worker fails loudly', () => {
    expect(buildConfig({ ...base, CAIRN_INLINE_JOBS: 'never' } as never).inlineJobs).toBe(false);
  });
});
