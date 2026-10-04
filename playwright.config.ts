import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  // These flows use their dedicated local-IndexedDB harness configurations.
  // The static demo preview intentionally does not install that harness.
  testIgnore: ["corporation-mvp-flow.spec.ts", "pathway-pipeline.spec.ts", "interface-*.spec.ts"],
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
