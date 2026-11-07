import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests", testMatch: "naics-sector.spec.ts", workers: 1, timeout: 120_000,
  expect: { timeout: 15_000 }, retries: 0, reporter: "list",
  outputDir: "tmp/naics-sector-results",
  use: {
    baseURL: "http://127.0.0.1:43953", screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: { command: "VITE_E2E_TEST_HARNESS=1 npx vite --host 127.0.0.1 --port 43953 --strictPort", port: 43953, reuseExistingServer: false, timeout: 90_000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
