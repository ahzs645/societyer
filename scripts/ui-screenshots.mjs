#!/usr/bin/env node
// Capture desktop + phone screenshots of demo routes and report horizontal
// overflow and page errors. Start the demo first, e.g.
//   VITE_E2E_TEST_HARNESS=1 npx vite --host 127.0.0.1 --port 4177 --strictPort
// then:
//   node scripts/ui-screenshots.mjs http://127.0.0.1:4177 tmp/shots /demo/app,/demo/app/financials [--dark] [--viewports=desktop,phone,tablet]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const [base, out, routesArg] = args.filter((arg) => !arg.startsWith("--"));
if (!base || !out || !routesArg) {
  console.error("usage: node scripts/ui-screenshots.mjs <baseUrl> <outDir> <route,...> [--dark] [--full] [--viewports=desktop,phone,tablet]");
  process.exit(1);
}
const routes = routesArg.split(",");
const allViewports = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024, hasTouch: true },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
};
const chosen = [...flags].find((flag) => flag.startsWith("--viewports="))?.split("=")[1]?.split(",") ?? ["desktop", "phone"];
const dark = flags.has("--dark");
const browser = await chromium.launch({ executablePath: process.env.SOCIETYER_CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
for (const name of chosen) {
  const vp = allViewports[name];
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    deviceScaleFactor: 1,
    colorScheme: dark ? "dark" : "light",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const file = `${out}/${name}${dark ? "-dark" : ""}-${route.replace(/[^a-z0-9]+/gi, "_")}.png`;
    await page.screenshot({ path: file, fullPage: flags.has("--full") });
    console.log(`${name}${dark ? " dark" : ""} ${route} overflowX=${overflow} ${errors.splice(0).join(" | ").slice(0, 400)}`);
  }
  await ctx.close();
}
await browser.close();
