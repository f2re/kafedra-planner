import { defineConfig } from '@playwright/test';

const port = 4175;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/plan-fact.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-plan-fact', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    browserName: 'chromium',
    viewport: { width: 1440, height: 980 }
  },
  webServer: {
    command: `KAFEDRA_BROWSER_PORT=${port} node tests/browser/start-server.mjs`,
    url: `http://127.0.0.1:${port}/api/system/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: 'plan-fact-desktop' }
  ]
});
