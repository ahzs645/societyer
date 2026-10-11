import { defineConfig } from "@playwright/test";

// WP-H browser flows (people merge, members & representatives, historical
// actions) on the persistent local runtime. Set PEOPLE_IDENTITY_URL to reuse a
// running local-indexeddb dev server.
export default defineConfig({
  testDir: "tests",
  testMatch: "people-identity.spec.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.PEOPLE_IDENTITY_URL ?? "http://127.0.0.1:4178",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: process.env.PEOPLE_IDENTITY_URL ? undefined : {
    command: "VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=people-identity-playwright npx vite --host 127.0.0.1 --port 4178 --strictPort",
    port: 4178,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } }],
});
