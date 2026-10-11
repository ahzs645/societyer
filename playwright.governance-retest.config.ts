import { defineConfig } from "@playwright/test";

// Governance retest flows (committee quorum and cadence, per-body quorum,
// recording a held AGM, coverage marks) on the persistent local runtime. Set
// GOVERNANCE_RETEST_URL to reuse a running local-indexeddb dev server.
export default defineConfig({
  testDir: "tests",
  testMatch: "governance-retest.spec.ts",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.GOVERNANCE_RETEST_URL ?? "http://127.0.0.1:4179",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: process.env.GOVERNANCE_RETEST_URL ? undefined : {
    command: "VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=governance-retest-playwright npx vite --host 127.0.0.1 --port 4179 --strictPort",
    port: 4179,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } }],
});
