import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests", testMatch: "billing-operations.spec.ts", timeout: 240_000,
  outputDir: "/workspace/scratch/billing-operations-browser",
  expect: { timeout: 30_000 }, workers: 1, retries: 0,
  use: { baseURL: process.env.BILLING_OPERATIONS_URL ?? "http://127.0.0.1:4188", headless: true, actionTimeout: 30_000, screenshot: "only-on-failure", trace: "retain-on-failure", viewport: { width: 1440, height: 1100 } },
  webServer: process.env.BILLING_OPERATIONS_URL ? undefined : { command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=billing-operations-playwright npx vite --host 127.0.0.1 --port 4188 --strictPort", port: 4188, reuseExistingServer: false, timeout: 90_000 },
});
