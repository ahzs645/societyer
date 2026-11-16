import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./playwright.chromium";

// Meeting notes (working meetings, AI notes, action items) on the local runtime. Set MEETING_NOTES_URL to
// reuse an already running local-runtime dev server.
const existing = process.env.MEETING_NOTES_URL;
const port = 4181;

export default defineConfig({
  testDir: "tests",
  testMatch: "meeting-notes.spec.ts",
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
    command: `VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=meeting-notes-playwright npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
