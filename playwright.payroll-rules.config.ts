import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-rules.spec.ts",
  outputDir: "/workspace/scratch/payroll-rules-browser",
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PAYROLL_RULES_URL ?? "http://127.0.0.1:4200",
    headless: true,
    viewport: { width: 1500, height: 1100 },
    timezoneId: "America/Vancouver",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.PAYROLL_RULES_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-rules-playwright npx vite --host 127.0.0.1 --port 4200 --strictPort",
        port: 4200,
        reuseExistingServer: false,
        timeout: 90000,
      },
});
