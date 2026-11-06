import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./playwright.chromium";

export default defineConfig({
  testDir: "tests", outputDir: "test-results/invoice-catalog-customers", testMatch: "invoice-catalog-customers.spec.ts", timeout: 180_000,
  expect: { timeout: 30_000 }, workers: 1, retries: 0,
  use: { baseURL: process.env.INVOICE_CATALOG_CUSTOMERS_URL ?? "http://127.0.0.1:4194", headless: true, launchOptions: chromiumLaunchOptions(),
    screenshot: "only-on-failure", trace: "retain-on-failure", viewport: { width: 1440, height: 1000 } },
  webServer: process.env.INVOICE_CATALOG_CUSTOMERS_URL ? undefined : {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=invoice-catalog-customers-playwright ./node_modules/.bin/vite --host 127.0.0.1 --port 4194 --strictPort",
    port: 4194, reuseExistingServer: false, timeout: 90_000,
  },
});
