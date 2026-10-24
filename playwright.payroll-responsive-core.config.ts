import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: [
    "payroll-calculation.spec.ts",
    "payroll-td1.spec.ts",
    "payroll-rules.spec.ts",
    "payroll-responsive-core.spec.ts",
  ],
  outputDir: "/workspace/scratch/payroll-responsive-core-browser",
  metadata: { payrollResponsive: true },
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PAYROLL_RESPONSIVE_CORE_URL ?? "http://127.0.0.1:4210",
    headless: true,
    actionTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    timezoneId: "America/Vancouver",
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 1000 },
        isMobile: false,
        hasTouch: false,
      },
    },
    {
      name: "touch-phone",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "touch-narrow",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.PAYROLL_RESPONSIVE_CORE_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-responsive-core-playwright npx vite --host 127.0.0.1 --port 4210 --strictPort",
        port: 4210,
        reuseExistingServer: false,
        timeout: 90_000,
      },
});
