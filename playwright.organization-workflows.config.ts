import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./playwright.chromium";

export default defineConfig({
  testDir: "tests",
  testMatch: "organization-workflows.spec.ts",
  outputDir: "test-results/organization-workflows",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4199",
    headless: true,
    launchOptions: chromiumLaunchOptions(),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_DISABLE_NATIVE_FILE_STORAGE=0 VITE_LOCAL_WORKSPACE_ID=organization-workflows-playwright ./node_modules/.bin/vite --host 127.0.0.1 --port 4199 --strictPort",
    port: 4199,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
