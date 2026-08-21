import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.KAFEDRA_BROWSER_PORT || 4181);

export default defineConfig({
  testDir: './tests/pin-browser',
  timeout: 75_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    browserName: 'chromium'
  },
  webServer: {
    command: `KAFEDRA_BROWSER_PORT=${port} node tests/pin-browser/start-pin-auth-server.mjs`,
    url: `http://127.0.0.1:${port}/api/system/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: 'pin-desktop', use: { viewport: { width: 1360, height: 900 } } },
    { name: 'pin-mobile', use: { ...devices['iPhone 15'] } }
  ]
});
