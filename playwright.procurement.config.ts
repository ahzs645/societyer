import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.SOCIETYER_CHROMIUM_PATH ?? (process.platform === "darwin" && existsSync(macChrome) ? macChrome : undefined);
export default defineConfig({
  testDir: "tests", testMatch: "procurement-analytics.spec.ts", timeout: 30000, workers: 1,
  outputDir: "tmp/procurement-browser-results", reporter: "list",
  use: { baseURL: "http://127.0.0.1:4185", launchOptions: executablePath ? { executablePath } : undefined, screenshot: "only-on-failure" },
  webServer: { command: "npx vite --host 127.0.0.1 --port 4185 --strictPort", port: 4185, reuseExistingServer: true },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } }, { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
});
