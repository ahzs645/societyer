import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./playwright.chromium";

export default defineConfig({
  testDir: "tests", testMatch: "invoice-lifecycle.spec.ts", outputDir: "test-results/invoice-lifecycle",
  timeout: 180_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  use: { baseURL: "http://127.0.0.1:4217", headless: true, colorScheme: "light", launchOptions: chromiumLaunchOptions(), screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=invoice-lifecycle-playwright node_modules/.bin/vite --host 127.0.0.1 --port 4217 --strictPort",
    port: 4217, reuseExistingServer: false, timeout: 90_000,
  },
});
