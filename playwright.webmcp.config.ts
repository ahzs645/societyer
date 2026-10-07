import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4175",
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: "npm run build:pages && npx vite preview --port 4175 --strictPort",
    port: 4175,
    reuseExistingServer: !process.env.CI,
    // build:pages typechecks Convex and the app and runs a full vite build first.
    timeout: 600_000,
  },
  projects: [
    {
      name: "chrome",
      use: { browserName: "chromium", channel: "chrome" },
    },
  ],
});
