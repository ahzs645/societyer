#!/usr/bin/env node
/**
 * Finds layout loops: a page that, left alone, keeps changing its layout on
 * every frame. They come from code that measures the page and switches its
 * layout on the result (a row of tabs or a menu, labelled or icon buttons, a
 * wide or stacked page) when the switch changes the measurement back. The
 * fix is src/lib/settledLayout.ts; this finds where one is still needed.
 *
 * It crawls the no-login demo from /demo/app, collecting the app's own links
 * (two levels deep by default), and opens each page at a few widths. After a
 * short settle, it counts layout shifts the page makes on its own (no input)
 * for a moment. A settled page makes none; a loop makes one every frame.
 * Pages that keep a moving element on purpose (a progress bar, a live
 * transcript) can show a few shifts, so only a steady run counts.
 *
 *   node scripts/check-layout-loops.mjs [base-url] [--widths 390,1024,1440,1920] [--depth 2] [--only /demo/app/procurement-review]
 *
 * The base URL defaults to http://127.0.0.1:5173 (a running Vite dev server).
 * Uses the repo's Playwright with the installed Chrome. Exits 1 when it finds
 * a loop, listing the page, the width and the elements that moved.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const base = (args.find((arg) => /^https?:\/\//.test(arg)) ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const widths = option("widths", "390,1024,1440,1920").split(",").map(Number);
const depth = Number(option("depth", "2"));
const only = option("only", "");
/** Shifts in the watch window that count as a loop (a loop at 60fps makes ~1 per frame). */
const LOOP_SHIFTS = 6;
const SETTLE_MS = 900;
const WATCH_MS = 700;

/** Layout shifts the page makes on its own while it is watched, and the elements that moved most. */
const idleShifts = (page) =>
  page.evaluate((ms) => new Promise((resolve) => {
    let shifts = 0;
    const moved = new Map();
    const label = (node) => {
      if (!node || node.nodeType !== 1) return "#text";
      const classes = String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      return `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
    };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        shifts += 1;
        for (const source of entry.sources ?? []) moved.set(label(source.node), (moved.get(label(source.node)) ?? 0) + 1);
      }
    });
    observer.observe({ type: "layout-shift", buffered: false });
    setTimeout(() => {
      observer.disconnect();
      resolve({ shifts, moved: [...moved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => `${name}×${count}`) });
    }, ms);
  }), WATCH_MS);

/** The page's own links into the demo app, without their query or hash. */
const appLinks = (page) =>
  page.evaluate(() => [...new Set(
    [...document.querySelectorAll('a[href^="/demo/app"]')]
      .map((anchor) => new URL(anchor.getAttribute("href"), location.origin).pathname)
      .filter((path) => !/\/(new|edit|print|export)(\/|$)/.test(path)),
  )]);

/** Moves within the single-page app (no reload), the way the app's own links do. */
const visit = async (page, path) => {
  await page.evaluate((target) => {
    history.pushState({}, "", target);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await page.waitForTimeout(SETTLE_MS);
};

const browser = await chromium.launch({ channel: "chrome" });
const findings = [];
try {
  // One crawl at desktop width collects the pages.
  const crawler = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await crawler.goto(`${base}/demo/app`, { waitUntil: "domcontentloaded" });
  await crawler.waitForSelector(".page", { timeout: 120_000 });
  await crawler.waitForTimeout(3000);
  const pages = new Set(only ? [only] : ["/demo/app"]);
  let frontier = [...pages];
  for (let level = 0; level < depth && !only; level += 1) {
    const next = [];
    for (const path of frontier) {
      await visit(crawler, path);
      for (const link of await appLinks(crawler)) if (!pages.has(link)) { pages.add(link); next.push(link); }
    }
    frontier = next;
  }
  await crawler.context().close();
  console.log(`Checking ${pages.size} pages at ${widths.join(", ")}px`);

  for (const width of widths) {
    const context = width <= 430
      ? await browser.newContext({ ...devices["iPhone 13"], viewport: { width, height: 844 } })
      : await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/demo/app`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".page", { timeout: 120_000 });
    await page.waitForTimeout(3000);
    for (const path of pages) {
      await visit(page, path);
      const result = await idleShifts(page);
      if (result.shifts >= LOOP_SHIFTS) {
        findings.push({ path, width, ...result });
        console.log(`LOOP ${path} @${width}px: ${result.shifts} shifts — ${result.moved.join(", ")}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (findings.length) {
  console.log(`\n${findings.length} layout loop(s) found.`);
  process.exit(1);
}
console.log("No layout loops found.");
