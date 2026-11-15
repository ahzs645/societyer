#!/usr/bin/env node
/**
 * Lists the app's vertical scroll areas and whether each keeps room for its
 * scrollbar (`scrollbar-gutter: stable`). Where scrollbars take room (Windows,
 * a mouse, macOS set to always show them), an area without it narrows by the
 * scrollbar's width the moment its content grows past it: expanding a
 * section in a side panel rewraps every line above it. See
 * src/styles/_scrollbars.scss for the rule that keeps that room.
 *
 * It crawls the no-login demo from /demo/app (two levels of the app's own
 * links) at desktop width, opening each page and, on the procurement list, a
 * notice in the side panel. Every element whose computed overflow-y is auto
 * or scroll is reported once per class name, with the pages it was seen on.
 *
 *   node scripts/check-scroll-containers.mjs [base-url] [--depth 2] [--all]
 *
 * The base URL defaults to http://127.0.0.1:5173. `--all` also lists areas
 * that already keep the room. Exits 1 when an area that scrolls (its
 * content is taller than it) doesn't.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const base = (args.find((arg) => /^https?:\/\//.test(arg)) ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const depth = Number(option("depth", "2"));
const showAll = args.includes("--all");

/** Every vertical scroll area on the page now: its class name, whether it keeps the gutter, and whether it scrolls. */
const scrollAreas = (page) =>
  page.evaluate(() => {
    const areas = [];
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      if (!/(auto|scroll)/.test(style.overflowY) || element.clientHeight === 0) continue;
      const classes = String(element.className && typeof element.className === "string" ? element.className : "")
        .split(/\s+/)
        .filter((name) => name && !/^is-|^has-/.test(name))
        .slice(0, 3)
        .join(".");
      areas.push({
        name: `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`,
        gutter: style.scrollbarGutter.includes("stable"),
        hidden: style.scrollbarWidth === "none",
        scrolls: element.scrollHeight > element.clientHeight + 1,
      });
    }
    return areas;
  });

const appLinks = (page) =>
  page.evaluate(() => [...new Set(
    [...document.querySelectorAll('a[href^="/demo/app"]')]
      .map((anchor) => new URL(anchor.getAttribute("href"), location.origin).pathname)
      .filter((path) => !/\/(new|edit|print|export)(\/|$)/.test(path)),
  )]);

const visit = async (page, path) => {
  await page.evaluate((target) => {
    history.pushState({}, "", target);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await page.waitForTimeout(900);
};

const seen = new Map();
const record = (areas, where) => {
  for (const area of areas) {
    const entry = seen.get(area.name) ?? { ...area, scrolls: false, pages: new Set() };
    entry.scrolls ||= area.scrolls;
    entry.gutter &&= area.gutter;
    entry.pages.add(where);
    seen.set(area.name, entry);
  }
};

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${base}/demo/app`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".page", { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const pages = new Set(["/demo/app"]);
  let frontier = ["/demo/app"];
  for (let level = 0; level < depth; level += 1) {
    const next = [];
    for (const path of frontier) {
      await visit(page, path);
      record(await scrollAreas(page), path);
      for (const link of await appLinks(page)) if (!pages.has(link)) { pages.add(link); next.push(link); }
    }
    frontier = next;
  }
  for (const path of frontier) {
    await visit(page, path);
    record(await scrollAreas(page), path);
  }
  // Places a page alone doesn't show: a notice in the side panel.
  await visit(page, "/demo/app/procurement-review?view=reader");
  for (let i = 0; i < 40; i += 1) {
    const text = await page.evaluate(() => document.querySelector(".page")?.innerText ?? "");
    if (/Analytics/.test(text) && !/Loading the published/.test(text)) break;
    await page.waitForTimeout(2500);
  }
  const row = page.locator(".page .record-table__identifier-button").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1500);
    record(await scrollAreas(page), "procurement notice panel");
  }
  console.log(`Checked ${pages.size} pages.\n`);
} finally {
  await browser.close();
}

let missing = 0;
for (const [name, area] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (area.hidden) continue;
  if (area.gutter && !showAll) continue;
  if (!area.gutter && area.scrolls) missing += 1;
  const pages = [...area.pages];
  console.log(`${area.gutter ? "keeps room " : area.scrolls ? "NO ROOM    " : "no room (didn't scroll here)"} ${name}  — ${pages.slice(0, 3).join(", ")}${pages.length > 3 ? ` +${pages.length - 3}` : ""}`);
}
console.log(missing ? `\n${missing} scroll area(s) that scroll without keeping room for the scrollbar.` : "\nEvery scroll area that scrolls keeps room for its scrollbar.");
process.exit(missing ? 1 : 0);
