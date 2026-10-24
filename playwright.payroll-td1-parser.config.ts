import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "payroll-td1-parser.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/payroll-td1-parser",
  use: {
    baseURL: "http://127.0.0.1:4207",
    headless: true,
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH
      ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH }
      : undefined,
  },
  webServer: {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-td1-parser-check npx vite --host 127.0.0.1 --port 4207 --strictPort",
    port: 4207,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
