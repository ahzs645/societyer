import { defineConfig } from "@playwright/test";

/** Dedicated actual Member fixture; kept outside the running main interface glob. */
export default defineConfig({
  testDir: "experiments/live-qualification/browser",
  testMatch: "eligible-member.spec.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: "tmp/live-election-browser-results",
  reporter: [["list"], ["json", { outputFile: "tmp/live-election-browser-results.json" }]],
  use: { baseURL: "http://127.0.0.1:43477", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "narrow-phone", use: { browserName: "chromium", viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
