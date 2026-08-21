import { defineConfig, devices } from '@playwright/test';

const port = 4177;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['**/auth.spec.mjs', '**/calendar-start-auth.spec.mjs'],
  timeout: 75_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-auth', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    browserName: 'chromium'
  },
  webServer: {
    command: `KAFEDRA_BROWSER_PORT=${port} node tests/browser/start-auth-server.mjs`,
    url: `http://127.0.0.1:${port}/api/system/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: 'auth-desktop', use: { viewport: { width: 1360, height: 900 } } },
    { name: 'auth-mobile', use: { ...devices['iPhone 15'] } }
  ]
});
