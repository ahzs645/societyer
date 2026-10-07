import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests", testMatch: "pathway-pipeline.spec.ts", timeout: 180_000, retries: 0,
  use: { baseURL: "http://localhost:4176", headless: true, screenshot: "only-on-failure", launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined },
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_E2E_TEST_HARNESS=1 VITE_LOCAL_WORKSPACE_ID=pathway-playwright npx vite --host 127.0.0.1 --port 4176 --strictPort",
    port: 4176, reuseExistingServer: false, timeout: 90_000,
  },
  outputDir: "tmp/pathway-ui-results",
  projects: [
    { name: "narrow-phone", use: { browserName: "chromium", viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
