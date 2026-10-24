import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "invoice-responsive.spec.ts",
  outputDir: "/workspace/scratch/invoice-responsive",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4215",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=invoice-responsive-playwright npx vite --host 127.0.0.1 --port 4215 --strictPort",
    port: 4215,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    { name: "touch390", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
    { name: "narrow360", use: { browserName: "chromium", viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  ],
});
