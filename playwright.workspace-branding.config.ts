import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./playwright.chromium";

export default defineConfig({
  testDir: "tests",
  outputDir: "test-results/workspace-branding",
  testMatch: "workspace-branding.spec.ts",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.WORKSPACE_BRANDING_URL ?? "http://127.0.0.1:4197",
    headless: true,
    colorScheme: "light",
    launchOptions: chromiumLaunchOptions(),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: process.env.WORKSPACE_BRANDING_URL ? undefined : {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=workspace-branding-playwright npx vite --host 127.0.0.1 --port 4197 --strictPort",
    port: 4197,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
