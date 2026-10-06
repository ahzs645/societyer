import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "meeting-history.spec.ts",
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4176",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: "VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=meeting-history-playwright npx vite --host 127.0.0.1 --port 4176 --strictPort",
    port: 4176,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
