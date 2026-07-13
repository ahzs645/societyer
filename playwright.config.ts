import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  // This flow uses the dedicated local-IndexedDB harness configured in
  // playwright.corporation.config.ts. Running it against the static demo
  // preview makes it wait forever for a harness that is intentionally absent.
  testIgnore: "corporation-mvp-flow.spec.ts",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build:pages && npx vite preview --port 4173",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
