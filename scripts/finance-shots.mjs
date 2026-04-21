import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const OUT = process.env.OUT_DIR || "/tmp/finance-shots";
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { slug: "01-financials", path: "/demo/app/financials" },
  { slug: "02-financials-fy", path: "/demo/app/financials/fy/2025-2026" },
  { slug: "03-wave-business", path: "/demo/app/financials/wave/business" },
  { slug: "04-wave-account", path: "/demo/app/financials/wave/account" },
  { slug: "05-wave-vendor", path: "/demo/app/financials/wave/vendor" },
  { slug: "06-wave-product", path: "/demo/app/financials/wave/product" },
  { slug: "07-wave-invoice", path: "/demo/app/financials/wave/invoice" },
  {
    slug: "08-wave-account-detail-operating",
    path: "/demo/app/financials/wave/account/static_wave_account_operating",
  },
  {
    slug: "09-wave-account-detail-grant",
    path: "/demo/app/financials/wave/account/static_wave_account_grant",
  },
  { slug: "10-finance-imports", path: "/demo/app/finance-imports" },
  { slug: "11-treasurer", path: "/demo/app/treasurer" },
  { slug: "12-grants", path: "/demo/app/grants" },
  { slug: "13-grant-detail", path: "/demo/app/grants/static_grant" },
  { slug: "14-grant-edit", path: "/demo/app/grants/static_grant/edit" },
  { slug: "15-reconciliation", path: "/demo/app/reconciliation" },
  { slug: "16-receipts", path: "/demo/app/receipts" },
  { slug: "17-membership", path: "/demo/app/membership" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const page = await ctx.newPage();
    const errorsByRoute = {};
    page.on("pageerror", (err) => {
      const key = page.url();
      (errorsByRoute[key] = errorsByRoute[key] || []).push(err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const key = page.url();
        (errorsByRoute[key] = errorsByRoute[key] || []).push(
          `[console.error] ${msg.text()}`,
        );
      }
    });

    for (const route of ROUTES) {
      const url = BASE + route.path;
      const pageErrors = [];
      const listener = (err) => pageErrors.push(err.message);
      page.on("pageerror", listener);
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
      } catch (e) {
        console.warn("goto timed out for", url, e.message);
      }
      // Wait a bit for shimmer/suspense
      await page.waitForTimeout(600);
      const hasShell = await page.locator(".app-shell").isVisible().catch(() => false);
      const file = `${OUT}/${route.slug}-${vp.name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const bodyBB = await page.evaluate(() => ({
        scrollHeight: document.body.scrollHeight,
        scrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }));
      // Also capture above-the-fold
      const foldPath = `${OUT}/${route.slug}-${vp.name}-fold.png`;
      await page.screenshot({ path: foldPath, fullPage: false });
      const overflow = bodyBB.scrollWidth > bodyBB.innerWidth + 1;
      console.log(
        JSON.stringify({
          vp: vp.name,
          path: route.path,
          shell: hasShell,
          overflow,
          body: bodyBB,
          errors: pageErrors,
          file,
        }),
      );
      page.off("pageerror", listener);
    }

    await ctx.close();
  }
} finally {
  await browser.close();
}
