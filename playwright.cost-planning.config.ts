import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "cost-planning.spec.ts",
  outputDir: "/workspace/scratch/cost-planning-browser",
  timeout: 150_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.COST_PLANNING_URL ?? "http://127.0.0.1:4194",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: process.env.COST_PLANNING_URL ? undefined : {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=cost-planning-playwright npx vite --host 127.0.0.1 --port 4194 --strictPort",
    port: 4194,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
