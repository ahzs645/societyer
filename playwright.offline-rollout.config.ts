import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests", testMatch: "offline-rollout-*.spec.ts", workers: 1, retries: 0,
  timeout: 180_000, expect: { timeout: 40_000 },
  outputDir: process.env.OFFLINE_ROLLOUT_OUTPUT ?? "tmp/offline-rollout-browser-results",
  reporter: [["list"], ["json", { outputFile: process.env.OFFLINE_ROLLOUT_REPORT ?? "tmp/offline-rollout-browser-results.json" }]],
  use: { baseURL: process.env.OFFLINE_ROLLOUT_URL ?? "http://127.0.0.1:43477", trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: process.env.OFFLINE_ROLLOUT_TEST_DNS === "1" ? { args: [...(process.env.OFFLINE_ROLLOUT_TEST_CERT_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.OFFLINE_ROLLOUT_TEST_CERT_SPKI}`] : []), "--no-proxy-server", "--host-resolver-rules=MAP societyer-qualification.test 127.0.0.1,MAP sync-qualification.test 127.0.0.1"] } : undefined },
  projects: [
    { name: "phone320", use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "phone390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
