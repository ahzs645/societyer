import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-roe-workflow.spec.ts",
  outputDir: "/workspace/scratch/payroll-responsive-roe",
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PAYROLL_RESPONSIVE_ROE_URL ?? "http://127.0.0.1:4211",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    timezoneId: "America/Vancouver",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "touch-phone",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "narrow-phone",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: process.env.PAYROLL_RESPONSIVE_ROE_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-responsive-roe-playwright npx vite --host 127.0.0.1 --port 4211 --strictPort",
        port: 4211,
        reuseExistingServer: false,
        timeout: 90000,
      },
});
