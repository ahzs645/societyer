import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests', testMatch: 'payroll-eht.spec.ts', outputDir: '/workspace/scratch/payroll-eht-browser',
  timeout: 180_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  use: { baseURL: process.env.PAYROLL_EHT_URL ?? 'http://127.0.0.1:4198', headless: true, viewport: { width: 1500, height: 1100 }, timezoneId: 'America/Vancouver', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.PAYROLL_EHT_URL ? undefined : { command: 'SOCIETYER_FROZEN_QUALIFICATION=1 VITE_RUNTIME_MODE=local-indexeddb VITE_LOCAL_WORKSPACE_ID=payroll-eht-playwright npx vite --host 127.0.0.1 --port 4198 --strictPort', port: 4198, reuseExistingServer: false, timeout: 90_000 },
});
