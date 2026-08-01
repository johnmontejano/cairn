import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests.
 *
 * Run against a real server with its own throwaway database and its own
 * encryption key, so a test run can never touch a developer's actual memory.
 * Desktop and mobile are both exercised: the journey has to work on a phone.
 */
const PORT = Number(process.env.CAIRN_E2E_PORT ?? 3311);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Migrate the throwaway database first, so the server comes up ready.
    command: 'pnpm db:migrate && pnpm --filter @cairn/web dev',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // A disposable database and key, so browser tests never see real data.
      PORT: String(PORT),
      CAIRN_LOCAL_DATA_DIR: '.cairn-e2e',
      CAIRN_MASTER_KEY: 'Y2Fpcm4tZTJlLWZpeGVkLWtleS1ub3QtYS1zZWNyZXQ=',
      CAIRN_MODE: 'demo',
      CAIRN_APP_URL: BASE_URL,
      AUTH_PROVIDER: 'fixture',
      AI_PROVIDER: 'fixture',
      // The intended production configuration, so the browser suite exercises
      // the path people will actually use. Connection codes still work in this
      // mode and are still covered; what changes is that pasting an address
      // becomes the primary route and gets a real round-trip test.
      MCP_AUTH_MODE: 'oauth',
      NODE_ENV: 'development',
      LOG_LEVEL: 'warn',
    },
  },
});
