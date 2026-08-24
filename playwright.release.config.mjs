import { defineConfig } from '@playwright/test';

const port = 4178;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/release-readiness.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-release', open: 'never' }]
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    browserName: 'chromium',
    viewport: { width: 1440, height: 960 }
  },
  webServer: {
    command: `KAFEDRA_AUTH_MODE=accounts KAFEDRA_BROWSER_PORT=${port} node tests/browser/start-release-server.mjs`,
    url: `http://127.0.0.1:${port}/api/system/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [{ name: 'release-readiness' }]
});
