import { defineConfig } from "@playwright/test";

// The sweep spec skips itself unless this is set, so the default
// `playwright.config.ts` (static demo, no setup harness) never runs it.
// Playwright loads the config in every worker, so the flag reaches the spec.
process.env.SOCIETYER_ENTITY_SWEEP = "1";

// Overridable so parallel checkouts on one machine do not collide.
const PORT = Number(process.env.ENTITY_SWEEP_PORT ?? 4183);

/**
 * Entity copy sweep: builds a BC corporation, a CBCA corporation, an OBCA
 * corporation, a custom existing entity and a BC society (control) through the
 * real guided setup, then visits every in-app route in each and flags
 * society-only copy. See docs/entity-copy-audit.md.
 *
 *   SOCIETYER_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:entity-sweep
 */
export default defineConfig({
  testDir: "tests",
  testMatch: "entity-copy-sweep.spec.ts",
  // One setup per workspace, then a shard of routes per test. Setup tests run
  // first (project dependency) and hand off their IndexedDB via storage state.
  fullyParallel: true,
  workers: process.env.ENTITY_SWEEP_WORKERS ? Number(process.env.ENTITY_SWEEP_WORKERS) : 4,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  retries: 0,
  outputDir: process.env.ENTITY_SWEEP_OUTPUT ?? "tmp/entity-sweep-results",
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: `VITE_E2E_TEST_HARNESS=1 npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: "entity-copy-sweep.spec.ts", grep: /@setup/, use: { browserName: "chromium" } },
    { name: "sweep", testMatch: "entity-copy-sweep.spec.ts", grep: /@shard/, dependencies: ["setup"], use: { browserName: "chromium" } },
    // The verdict reads every shard's findings, so it runs last. Shards only
    // fail on crashes, which keeps this project from being skipped on leaks.
    { name: "report", testMatch: "entity-copy-sweep.spec.ts", grep: /@verdict/, dependencies: ["sweep"], use: { browserName: "chromium" } },
  ],
});
