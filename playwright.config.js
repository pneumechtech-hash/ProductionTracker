// End-to-end tests for PO Tracker. Run with: npm test
const { defineConfig } = require('@playwright/test');

// Tests build timestamps like "2026-10-21T09:00" in local time; pin the zone
// so the test process and the browser agree on what "local" means.
const TZ = 'America/Toronto';
process.env.TZ = TZ;

const PORT = 4173;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    timezoneId: TZ,
    locale: 'en-CA',
    viewport: { width: 390, height: 844 }, // phone-sized, like the real device
    serviceWorkers: 'block',               // keep the SW cache out of the tests
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node tests/server.js ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
