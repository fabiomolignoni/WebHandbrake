import { defineConfig } from '@playwright/test';

/**
 * End-to-end suite (docs/testing.md): every scenario runs in Chromium and in Firefox with the test
 * build of the extension (npm run build:test). Select a browser with --project=chromium|firefox.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 3,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});
