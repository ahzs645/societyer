import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", timeout: 60_000, expect: { timeout: 15_000 }, workers: 1, retries: 0,
  outputDir: "../../tmp/offline-evaluation-browser-results",
  reporter: [["list"], ["json", { outputFile: "../../tmp/offline-evaluation-browser.json" }]],
  use: { baseURL: "http://127.0.0.1:4192", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:4192", reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: "phone", use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
