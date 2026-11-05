import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "invoice-preview-controls.spec.ts",
  outputDir: "/workspace/scratch/invoice-preview-controls/browser-results",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4190",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1600, height: 1100 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=invoice-preview-controls-playwright npx vite --host 127.0.0.1 --port 4190 --strictPort",
    port: 4190,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
