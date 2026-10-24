import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  // These flows use their dedicated local-IndexedDB harness configurations.
  // The static demo preview intentionally does not install that harness.
  // live-interface-* and offline-rollout-* need the isolated live-qualification
  // backend (or the Vite dev server's /src modules) and run under their own configs.
  testIgnore: [
    "invoice-commerce.spec.ts",
    "document-designer.spec.ts",
    "zoho-completion.spec.ts",
    "billing-operations.spec.ts",
    "billing-automation.spec.ts",
    "bill-adjustments.spec.ts",
    "commerce-reports.spec.ts",
    "invoice-money.spec.ts",
    "year-end-currency.spec.ts",
    "cost-planning.spec.ts",
    "payroll-calculation.spec.ts",
    "payroll-filings.spec.ts",
    "payroll-leave.spec.ts",
    "payroll-eht.spec.ts",
    "payroll-td1.spec.ts",
    "payroll-propagation.spec.ts",
    "payroll-responsive-core.spec.ts",
    "finance-responsive.spec.ts",
    "invoice-responsive.spec.ts",
    "responsive-shell.spec.ts",
    "payroll-td1-parser.spec.ts",
    "payroll-rules.spec.ts",
    "payroll-roe-workflow.spec.ts",
    "payroll-remittance.spec.ts",
    "corporation-mvp-flow.spec.ts",
    "corporation-governance-copy.spec.ts",
    "pathway-pipeline.spec.ts",
    "interface-*.spec.ts",
    "live-interface-*.spec.ts",
    "offline-rollout-*.spec.ts",
    "guided-setup.spec.ts",
    "governance-retest.spec.ts",
    "meeting-history.spec.ts",
    "meetings-editing.spec.ts",
    "people-identity.spec.ts",
    "agreements.spec.ts",
  ],
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: process.env.SOCIETYER_CHROMIUM_PATH ? { executablePath: process.env.SOCIETYER_CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: "npm run build:pages && npx vite preview --port 4173",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    // build:pages typechecks Convex and the app and runs a full vite build first.
    timeout: 600_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
