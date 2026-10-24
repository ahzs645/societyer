import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-filings.spec.ts",
  outputDir: "/workspace/scratch/payroll-filings-browser",
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PAYROLL_FILINGS_URL ?? "http://127.0.0.1:4196",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Vancouver",
  },
  webServer: process.env.PAYROLL_FILINGS_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-filings-playwright npx vite --host 127.0.0.1 --port 4196 --strictPort",
        port: 4196,
        reuseExistingServer: false,
        timeout: 90000,
      },
});
