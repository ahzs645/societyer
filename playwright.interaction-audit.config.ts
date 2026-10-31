import { defineConfig } from '@playwright/test';
const port = 4192;
export default defineConfig({
  testDir: 'tests', testMatch: 'interaction-audit.spec.ts', timeout: 120_000, expect: { timeout: 20_000 },
  fullyParallel: false, workers: 1, retries: 0, maxFailures: process.env.CI ? 3 : 0, outputDir: 'tmp/interaction-audit-browser',
  reporter: [['list'], ['json', { outputFile: 'tmp/interaction-audit-results.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, timezoneId: 'America/Vancouver', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined },
  webServer: { command: `VITE_RUNTIME_MODE=local-indexeddb VITE_E2E_TEST_HARNESS=1 VITE_LOCAL_WORKSPACE_ID=interaction-audit npx vite --host 127.0.0.1 --port ${port} --strictPort`, port, reuseExistingServer: false, timeout: 90_000 },
  projects: [
    { name: 'narrow-phone', use: { browserName: 'chromium', viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
});
