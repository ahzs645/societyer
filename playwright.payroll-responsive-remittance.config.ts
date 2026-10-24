import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-remittance.spec.ts",
  outputDir: "/workspace/scratch/payroll-responsive-remittance-browser",
  timeout: 240000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL:
      process.env.PAYROLL_RESPONSIVE_REMITTANCE_URL ?? "http://127.0.0.1:4212",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    timezoneId: "America/Vancouver",
    actionTimeout: 30000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        viewport: { width: 1440, height: 1000 },
        isMobile: false,
        hasTouch: false,
      },
    },
    {
      name: "touch-phone",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: "narrow-phone",
      use: {
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: process.env.PAYROLL_RESPONSIVE_REMITTANCE_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-responsive-remittance npx vite --host 127.0.0.1 --port 4212 --strictPort",
        port: 4212,
        reuseExistingServer: false,
        timeout: 90000,
      },
});
