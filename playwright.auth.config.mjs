import { defineConfig } from '@playwright/test';

const port = 4177;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/auth.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-auth', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    browserName: 'chromium',
    viewport: { width: 1360, height: 900 }
  },
  webServer: {
    command: `KAFEDRA_BROWSER_PORT=${port} node tests/browser/start-auth-server.mjs`,
    url: `http://127.0.0.1:${port}/api/system/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [{ name: 'auth-desktop' }]
});
