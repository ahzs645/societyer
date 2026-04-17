import { chromium } from "@playwright/test";

const URL = "http://localhost:4173/";
const browser = await chromium.launch();

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
});
const page = await ctx.newPage();
await page.addInitScript(() => {
  try { localStorage.removeItem("societyer.theme"); } catch (e) {}
});
await page.goto(URL, { waitUntil: "networkidle" });

const height = await page.evaluate(() => document.body.scrollHeight);
console.log("Body height:", height);

await page.setViewportSize({ width: 1440, height });
await page.waitForTimeout(400);

const regions = [
  ["01-hero", 0, 900],
  ["02-preview", 500, 900],
  ["03-pain", 1400, 700],
  ["04-features", 2100, 700],
  ["05-workflow", 2800, 500],
  ["06-compliance", 3300, 800],
  ["07-highlights", 4100, 600],
  ["08-personas", 4700, 700],
  ["09-selfhost", 5400, 800],
  ["10-faq", 6200, 800],
  ["11-cta", 7000, 800],
];

for (const [name, y, h] of regions) {
  if (y + h > height) break;
  await page.screenshot({ path: `/tmp/zl-${name}.png`, clip: { x: 0, y, width: 1440, height: h } });
  console.log("Shot:", name);
}

console.log("done");
await browser.close();
