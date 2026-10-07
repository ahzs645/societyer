import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "interface-*.spec.ts",
  timeout: 35_000,
  expect: { timeout: 12_000 },
  fullyParallel: true,
  outputDir: process.env.INTERFACE_AUDIT_OUTPUT ?? "tmp/interface-suite-results",
  workers: 2,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: process.env.INTERFACE_AUDIT_REPORT ?? "tmp/interface-results.json" }]],
  use: {
    baseURL: process.env.INTERFACE_AUDIT_URL ?? "http://127.0.0.1:4177",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Machines with a preinstalled Chromium (rather than `playwright install`)
    // point at it here; specs that set their own launchOptions keep it too.
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: process.env.INTERFACE_AUDIT_URL ? undefined : {
    command: "VITE_E2E_TEST_HARNESS=1 npx vite --host 127.0.0.1 --port 4177 --strictPort",
    port: 4177,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "narrow-phone", use: { browserName: "chromium", viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
