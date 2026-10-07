import { defineConfig } from "@playwright/test";

/** This suite requires the actual isolated Convex backend and Better Auth broker.
 * No local-runtime/demo fallback or mocked query transport is allowed. */
export default defineConfig({
  testDir: "tests",
  testMatch: "live-interface-*.spec.ts",
  timeout: 180_000,
  expect: { timeout: 12_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  outputDir: process.env.LIVE_INTERFACE_OUTPUT ?? "tmp/live-interface-results",
  reporter: [["list"], ["json", { outputFile: process.env.LIVE_INTERFACE_REPORT ?? "tmp/live-interface-results.json" }]],
  use: {
    baseURL: process.env.LIVE_INTERFACE_URL ?? "http://127.0.0.1:43477",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "narrow-phone", use: { browserName: "chromium", viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
