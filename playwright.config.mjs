import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node tests/browser/start-server.mjs',
    url: 'http://127.0.0.1:4173/api/system/health',
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: ['**/work-management.spec.mjs', '**/reports-science.spec.mjs'],
      use: { browserName: 'chromium', viewport: { width: 1440, height: 980 } }
    },
    {
      name: 'mobile',
      testIgnore: ['**/work-management.spec.mjs', '**/reports-science.spec.mjs'],
      use: { ...devices['iPhone 15'], browserName: 'chromium' }
    },
    {
      name: 'workflow-desktop',
      testMatch: '**/work-management.spec.mjs',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 980 } }
    }
  ]
});
