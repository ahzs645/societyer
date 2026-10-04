import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests", testMatch: "pathway-pipeline.spec.ts", timeout: 180_000, retries: 0,
  use: { baseURL: "http://localhost:4176", headless: true, screenshot: "only-on-failure" },
  webServer: {
    command: "VITE_RUNTIME_MODE=local-indexeddb VITE_E2E_TEST_HARNESS=1 VITE_LOCAL_WORKSPACE_ID=pathway-playwright npx vite --host 127.0.0.1 --port 4176 --strictPort",
    port: 4176, reuseExistingServer: false, timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
