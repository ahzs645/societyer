import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "finance-responsive.spec.ts",
  outputDir: "/workspace/scratch/finance-responsive-browser",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.FINANCE_RESPONSIVE_URL ?? "http://127.0.0.1:4214",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    timezoneId: "America/Vancouver",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "touch-phone",
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "narrow-phone",
      use: {
        viewport: { width: 360, height: 800 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: process.env.FINANCE_RESPONSIVE_URL
    ? undefined
    : {
        command:
          "SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=finance-responsive-playwright npx vite --host 127.0.0.1 --port 4214 --strictPort",
        port: 4214,
        reuseExistingServer: false,
        timeout: 90_000,
      },
});
