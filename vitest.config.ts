import { defineConfig } from 'vitest/config';

/**
 * Test projects, split by what they prove rather than by directory, so
 * `pnpm test:security` runs exactly the checks a reviewer would ask about.
 *
 * All of them use real PostgreSQL through PGlite and none of them reach the
 * network. Timeouts are generous because each file boots its own database; the
 * values are repeated per project because project config is not inherited.
 */
const shared = {
  environment: 'node' as const,
  globals: false,
  testTimeout: 90_000,
  hookTimeout: 90_000,
};

export default defineConfig({
  test: {
    ...shared,
    pool: 'forks',
    projects: [
      { test: { ...shared, name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { test: { ...shared, name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
      { test: { ...shared, name: 'security', include: ['tests/security/**/*.test.ts'] } },
      { test: { ...shared, name: 'mcp', include: ['tests/mcp/**/*.test.ts'] } },
    ],
  },
});
