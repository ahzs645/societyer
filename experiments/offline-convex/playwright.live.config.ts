import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./live-tests", timeout: 120_000, expect: { timeout: 40_000 }, workers: 1, retries: 0,
  outputDir: "../../tmp/live-powersync-browser-results",
  reporter: [["list"], ["json", { outputFile: "../../tmp/live-powersync-browser.json" }]],
  use: { baseURL: "http://127.0.0.1:4195", trace: "retain-on-failure" },
  webServer: { command: "SOCIETYER_LOCAL_LIVE_PILOT=1 ../../node_modules/.bin/vite preview --host 127.0.0.1 --port 4195 --strictPort", url: "http://127.0.0.1:4195", reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: "phone320", use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "phone390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
