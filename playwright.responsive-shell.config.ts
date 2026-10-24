import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "responsive-shell.spec.ts",
  outputDir: "/workspace/scratch/responsive-shell-browser",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4216",
    headless: true,
    actionTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    timezoneId: "America/Vancouver",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "touch-phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: "touch-narrow", use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=responsive-shell-playwright npx vite --host 127.0.0.1 --port 4216 --strictPort",
    port: 4216,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
