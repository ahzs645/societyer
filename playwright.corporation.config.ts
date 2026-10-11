import { defineConfig } from "@playwright/test";

// Overridable so parallel checkouts on one machine do not collide.
const PORT = Number(process.env.CORPORATION_FLOW_PORT ?? 4175);

export default defineConfig({
  testDir: "tests",
  testMatch: ["corporation-mvp-flow.spec.ts", "corporation-governance-copy.spec.ts"],
  // Every step reloads the app and waits for the local workspace to hydrate.
  timeout: 180_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: `VITE_RUNTIME_MODE=local-indexeddb VITE_E2E_TEST_HARNESS=1 VITE_LOCAL_WORKSPACE_ID=corporation-mvp-playwright npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
