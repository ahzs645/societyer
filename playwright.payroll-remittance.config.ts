import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-remittance.spec.ts",
  outputDir: "/workspace/scratch/payroll-remittance-browser",
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PAYROLL_REMITTANCE_URL ?? "http://127.0.0.1:4202",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Vancouver",
    actionTimeout: 30000,
  },
  webServer: process.env.PAYROLL_REMITTANCE_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-remittance-playwright npx vite --host 127.0.0.1 --port 4202 --strictPort",
        port: 4202,
        reuseExistingServer: false,
        timeout: 90000,
      },
});
