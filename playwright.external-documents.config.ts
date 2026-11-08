import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./playwright.chromium";

const port = Number(process.env.EXTERNAL_DOCUMENTS_PORT ?? 4189);

export default defineConfig({
  testDir: "tests",
  testMatch: "interface-external-documents.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "tmp/external-document-sources-results",
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: chromiumLaunchOptions(),
  },
  webServer: {
    command: `VITE_E2E_TEST_HARNESS=1 node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
