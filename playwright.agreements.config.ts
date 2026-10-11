import { defineConfig } from "@playwright/test";

// Agreements register spec on the local runtime. Set AGREEMENTS_URL to reuse an
// already running local-runtime dev server.
const existing = process.env.AGREEMENTS_URL;
const port = 4179;

export default defineConfig({
  testDir: "tests",
  testMatch: "agreements.spec.ts",
  timeout: 180_000,
  retries: 0,
  use: {
    baseURL: existing ?? `http://127.0.0.1:${port}`,
    headless: true,
    timezoneId: "America/Vancouver",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: existing ? undefined : {
    command: `VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=agreements-playwright npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "desktop", use: { browserName: "chromium" } }],
});
