import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "invoice-payment-branding.spec.ts",
  outputDir: "/workspace/scratch/invoice-payment-branding/browser-results",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4188",
    headless: true,
    viewport: { width: 1600, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=invoice-payment-branding-playwright npx vite --host 127.0.0.1 --port 4188 --strictPort",
    port: 4188,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
