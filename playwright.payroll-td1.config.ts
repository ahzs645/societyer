import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-td1.spec.ts",
  outputDir: "/workspace/scratch/payroll-td1-browser",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PAYROLL_TD1_URL ?? "http://127.0.0.1:4199",
    headless: true,
    actionTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1080 },
    timezoneId: "America/Vancouver",
  },
  webServer: process.env.PAYROLL_TD1_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-td1-playwright npx vite --host 127.0.0.1 --port 4199 --strictPort",
        port: 4199,
        reuseExistingServer: false,
        timeout: 90_000,
      },
});
