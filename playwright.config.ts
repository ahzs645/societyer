import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  // These flows use their dedicated local-IndexedDB harness configurations.
  // The static demo preview intentionally does not install that harness.
  // live-interface-* and offline-rollout-* need the isolated live-qualification
  // backend (or the Vite dev server's /src modules) and run under their own configs.
  testIgnore: [
    "corporation-mvp-flow.spec.ts",
    "pathway-pipeline.spec.ts",
    "interface-*.spec.ts",
    "live-interface-*.spec.ts",
    "offline-rollout-*.spec.ts",
    "guided-setup.spec.ts",
    "meeting-history.spec.ts",
    "meetings-editing.spec.ts",
    "people-identity.spec.ts",
  ],
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: "npm run build:pages && npx vite preview --port 4173",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    // build:pages typechecks Convex and the app and runs a full vite build first.
    timeout: 600_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
