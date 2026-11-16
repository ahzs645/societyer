import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./playwright.chromium";

// Meeting recordings on the local runtime with desktop-style file storage (a stand-in bridge). Set MEETING_RECORDINGS_URL to
// reuse an already running local-runtime dev server.
const existing = process.env.MEETING_RECORDINGS_URL;
const port = 4182;

export default defineConfig({
  testDir: "tests",
  testMatch: "meeting-recordings.spec.ts",
  timeout: 180_000,
  retries: 0,
  use: {
    baseURL: existing ?? `http://127.0.0.1:${port}`,
    headless: true,
    timezoneId: "America/Vancouver",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    launchOptions: chromiumLaunchOptions(),
  },
  webServer: existing ? undefined : {
    command: `VITE_RUNTIME_MODE=local-indexeddb VITE_DOCUMENT_STORAGE_PROVIDER=local-filesystem VITE_LOCAL_WORKSPACE_ID=meeting-recordings-playwright npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
