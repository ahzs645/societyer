import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests", testMatch: "year-end-currency.spec.ts", outputDir: "/workspace/scratch/year-end-currency-browser", timeout: 240_000, workers: 1, retries: 0,
  expect: { timeout: 30_000 },
  use: { baseURL: "http://127.0.0.1:4193", headless: true, viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=year-end-currency-playwright npx vite --host 127.0.0.1 --port 4193 --strictPort", port: 4193, reuseExistingServer: false, timeout: 90_000 },
});
