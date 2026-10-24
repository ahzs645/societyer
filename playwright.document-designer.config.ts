import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests", outputDir: "/workspace/scratch/document-designer-browser",
  testMatch: "document-designer.spec.ts",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.DOCUMENT_DESIGNER_URL ?? "http://127.0.0.1:4183",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: process.env.DOCUMENT_DESIGNER_URL ? undefined : {
    command: "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=document-designer-playwright npx vite --host 127.0.0.1 --port 4183 --strictPort",
    port: 4183,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
