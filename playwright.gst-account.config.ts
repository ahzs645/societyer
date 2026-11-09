import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./playwright.chromium";

export default defineConfig({
  testDir: "tests", testMatch: "gst-account-reference.spec.ts", outputDir: "test-results/gst-account-reference",
  timeout: 180_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4216", headless: true, launchOptions: chromiumLaunchOptions(),
    actionTimeout: 30_000,
    screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=gst-account-playwright ./node_modules/.bin/vite --host 127.0.0.1 --port 4216 --strictPort",
    port: 4216, reuseExistingServer: false, timeout: 90_000,
  },
});
