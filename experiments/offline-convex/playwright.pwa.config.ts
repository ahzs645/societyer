import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./pwa-tests", timeout: 60_000, workers: 1, retries: 0,
  expect: { timeout: 15_000 }, outputDir: "../../tmp/meeting-pwa-results",
  reporter: [["list"], ["json", { outputFile: "../../tmp/meeting-pwa-browser.json" }]],
  use: { baseURL: "http://127.0.0.1:4193", trace: "retain-on-failure" },
  webServer: { command: "npm run preview", url: "http://127.0.0.1:4193", reuseExistingServer: false, timeout: 60_000 },
  projects: [
    { name: "phone", use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
