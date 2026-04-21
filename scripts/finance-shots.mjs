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
      await page.waitForTimeout(800);

      // Find the scrollable main content area for a "full" capture
      const metrics = await page.evaluate(() => {
        const main = document.querySelector(".main");
        const pageEl = document.querySelector(".page");
        const bodyW = document.documentElement.clientWidth;
        const pageScroll = pageEl
          ? { sh: pageEl.scrollHeight, ch: pageEl.clientHeight, sw: pageEl.scrollWidth }
          : null;
        const mainScroll = main
          ? { sh: main.scrollHeight, ch: main.clientHeight, sw: main.scrollWidth }
          : null;
        return { bodyW, pageScroll, mainScroll };
      });

      // Capture above-the-fold
      const foldPath = `${OUT}/${route.slug}-${vp.name}-fold.png`;
      await page.screenshot({ path: foldPath, fullPage: false });

      // For a "full content" capture, resize viewport to the content height
      // so the whole scroll container is visible in one screenshot.
      const contentH = Math.max(
        metrics.mainScroll?.sh || 0,
        metrics.pageScroll?.sh || 0,
        vp.height,
      );
      const tallVp = Math.min(contentH + 40, 6000);
      if (tallVp > vp.height + 10) {
        await page.setViewportSize({ width: vp.width, height: tallVp });
        await page.waitForTimeout(300);
        const fullPath = `${OUT}/${route.slug}-${vp.name}-full.png`;
        await page.screenshot({ path: fullPath, fullPage: false });
        // Reset viewport for next route
        await page.setViewportSize({ width: vp.width, height: vp.height });
      }

      const overflow = (metrics.mainScroll?.sw || 0) > metrics.bodyW + 1;
      console.log(
        JSON.stringify({
          vp: vp.name,
          path: route.path,
          contentH,
          overflow,
          errors: pageErrors,
        }),
      );
      page.off("pageerror", listener);
    }

    await ctx.close();
  }
} finally {
  await browser.close();
}
