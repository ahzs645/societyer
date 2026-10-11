import { defineConfig } from "@playwright/test";

// WP-G meetings editing spec on the local runtime. Set MEETINGS_EDITING_URL to
// reuse an already running local-runtime dev server.
const existing = process.env.MEETINGS_EDITING_URL;
const port = 4178;

export default defineConfig({
  testDir: "tests",
  testMatch: "meetings-editing.spec.ts",
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
    command: `VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=meetings-editing-playwright npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
