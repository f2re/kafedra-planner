import { defineConfig, devices } from '@playwright/test';

const port = 4179;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'acl.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `KAFEDRA_AUTH_MODE=accounts KAFEDRA_BROWSER_PORT=${port} node tests/browser/start-acl-server.mjs`,
    url: `http://127.0.0.1:${port}/api/system/health`,
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    {
      name: 'acl-desktop',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
