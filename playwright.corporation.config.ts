import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "corporation-mvp-flow.spec.ts",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4175",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "VITE_RUNTIME_MODE=local-indexeddb VITE_E2E_TEST_HARNESS=1 VITE_LOCAL_WORKSPACE_ID=corporation-mvp-playwright npx vite --host 127.0.0.1 --port 4175 --strictPort",
    port: 4175,
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
