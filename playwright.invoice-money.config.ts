import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests", testMatch: "invoice-money.spec.ts", timeout: 240_000,
  expect: { timeout: 30_000 }, workers: 1, retries: 0,
  outputDir: "/workspace/scratch/invoice-money-browser", reporter: "line",
  use: {
    baseURL: process.env.INVOICE_MONEY_URL ?? "http://127.0.0.1:4189", headless: true,
    actionTimeout: 30_000, navigationTimeout: 60_000,
    screenshot: "only-on-failure", trace: "retain-on-failure", viewport: { width: 1440, height: 1100 },
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: process.env.INVOICE_MONEY_URL ? undefined : {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=invoice-money-playwright npx vite --host 127.0.0.1 --port 4189 --strictPort",
    port: 4189, reuseExistingServer: false, timeout: 90_000,
  },
});
