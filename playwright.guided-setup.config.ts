import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests", testMatch: "guided-setup.spec.ts", workers: 2, timeout: 120_000,
  expect: { timeout: 15_000 }, retries: 0,
  outputDir: process.env.GUIDED_SETUP_OUTPUT ?? "tmp/guided-setup-results",
  reporter: [["list"], ["json", { outputFile: process.env.GUIDED_SETUP_REPORT ?? "tmp/guided-setup-results.json" }]],
  use: { baseURL: "http://127.0.0.1:43951", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "VITE_E2E_TEST_HARNESS=1 npx vite --host 127.0.0.1 --port 43951 --strictPort", port: 43951, reuseExistingServer: false, timeout: 90_000 },
  projects: [
    { name: "narrow-phone", use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
