import base from '../../playwright.config.mjs';

export default {
  ...base,
  testDir: '.',
  testMatch: 'zero-confirmation-intake.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: [
    {
      name: 'grace-intake-desktop',
      use: {
        ...(base.use || {}),
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: 'grace-intake-mobile',
      use: {
        ...(base.use || {}),
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      }
    }
  ]
};
