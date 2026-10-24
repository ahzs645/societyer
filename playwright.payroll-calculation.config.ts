import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-calculation.spec.ts",
  outputDir: "/workspace/scratch/payroll-calculation-browser",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PAYROLL_CALCULATION_URL ?? "http://127.0.0.1:4195",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Vancouver",
  },
  webServer: process.env.PAYROLL_CALCULATION_URL ? undefined : {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-calculation-playwright npx vite --host 127.0.0.1 --port 4195 --strictPort",
    port: 4195,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
