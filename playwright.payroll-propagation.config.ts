import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-propagation.spec.ts",
  outputDir: "/workspace/scratch/payroll-propagation-browser",
  timeout: 300000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  maxFailures: 1,
  use: {
    baseURL: process.env.PAYROLL_PROPAGATION_URL ?? "http://127.0.0.1:4213",
    headless: true,
    timezoneId: "America/Vancouver",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1500, height: 1100 } } },
    {
      name: "touch-phone",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: process.env.PAYROLL_PROPAGATION_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-propagation-playwright npx vite --host 127.0.0.1 --port 4213 --strictPort",
        port: 4213,
        reuseExistingServer: false,
        timeout: 90000,
      },
});
