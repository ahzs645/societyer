import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests", outputDir: "/workspace/scratch/invoice-commerce-browser", testMatch: "invoice-commerce.spec.ts", timeout: 180_000,
  expect: { timeout: 30_000 }, workers: 1, retries: 0,
  use: { baseURL: process.env.INVOICE_COMMERCE_URL ?? "http://127.0.0.1:4181", headless: true,
    screenshot: "only-on-failure", trace: "retain-on-failure", viewport: { width: 1440, height: 1000 } },
  webServer: process.env.INVOICE_COMMERCE_URL ? undefined : {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=invoice-commerce-playwright npx vite --host 127.0.0.1 --port 4181 --strictPort",
    port: 4181, reuseExistingServer: false, timeout: 90_000,
  },
});
