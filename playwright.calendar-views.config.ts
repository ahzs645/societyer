import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: /interface-(calendar-views|editor-fallback)\.spec\.ts/,
  timeout: 100_000,
  expect: { timeout: 15_000 },
  workers: 1,
  outputDir: process.env.CALENDAR_TEST_OUTPUT ?? "tmp/gap-calendar-results",
  reporter: [["list"], ["json", { outputFile: process.env.CALENDAR_TEST_REPORT ?? "tmp/gap-calendar-results.json" }]],
  use: { baseURL: process.env.INTERFACE_AUDIT_URL ?? "http://127.0.0.1:4189", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: ["chromium", "firefox"].flatMap((browser) => [320, 390, 768, 1440].map((width) => ({
    name: `${browser}-${width}`,
    use: {
      browserName: browser as "chromium" | "firefox", viewport: { width, height: 900 }, hasTouch: width < 980,
      launchOptions: browser === "chromium" && process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
    },
  }))),
});
