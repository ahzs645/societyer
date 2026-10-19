import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, info) => {
  test.skip(!["desktop", "phone"].includes(info.project.name));
  await page.goto("/scripts/fixtures/file-preview.html");
});

test("PDF scroll stays inside the preview without gutters or page overflow", async ({ page }) => {
  const baseline = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.scrollHeight }));
  await page.getByRole("button", { name: "Open 120-page PDF", exact: true }).click();
  const viewport = page.getByTestId("file-pdf-preview");
  await expect(viewport.locator("canvas").first()).toBeVisible();
  await expect(page.locator("body > canvas.hiddenCanvasElement")).toHaveCSS("display", "none");
  await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(baseline.width);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(baseline.height);
  const width = await viewport.evaluate(e => ({ client: e.clientWidth, bounds: e.getBoundingClientRect().width }));
  expect(width.client).toBeCloseTo(width.bounds, 0);
  const thumb = viewport.locator("..").locator(":scope > .scroll-area__thumb--y");
  await expect(thumb).toHaveCSS("opacity", "0");
  await viewport.focus();
  await viewport.press("PageDown");
  await expect.poll(() => viewport.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await expect(thumb).toHaveCSS("opacity", "0.65");
  const beforeDrag = await viewport.evaluate(e => e.scrollTop);
  const handle = await thumb.boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down(); await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + 35); await page.mouse.up();
  await expect.poll(() => viewport.evaluate(e => e.scrollTop)).toBeGreaterThan(beforeDrag);
  await expect(thumb).toHaveCSS("opacity", "0", { timeout: 3000 });
  expect(await viewport.evaluate(e => e.clientWidth)).toBe(width.client);
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  for (const selector of [".modal__body", ".document-preview-pane__viewport"]) {
    expect(await page.locator(selector).evaluate(e => ({ top: e.scrollTop, overflow: e.scrollHeight - e.clientHeight }))).toEqual({ top: 0, overflow: 0 });
  }
  // Both scrollbar axes remain overlays at a zoom wider than the viewport.
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(() => viewport.evaluate(e => e.scrollWidth - e.clientWidth)).toBeGreaterThan(0);
  expect(await viewport.evaluate(e => e.clientWidth)).toBe(width.client);
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(baseline.height);
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(baseline.width);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(baseline.height);
});

test("Word and inline PDF readers share the bounded scrolling surface", async ({ page }) => {
  await page.getByRole("button", { name: "Open wide Word file", exact: true }).click();
  const word = page.getByTestId("file-docx-preview");
  await expect(word.locator("section.docx").first()).toBeVisible();
  await expect.poll(() => word.evaluate(e => e.scrollHeight - e.clientHeight)).toBeGreaterThan(0);
  await word.focus(); await word.press("PageDown");
  await expect.poll(() => word.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(await page.evaluate(() => innerHeight));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Show 120-page PDF inline", exact: true }).click();
  const pdf = page.getByTestId("file-pdf-preview");
  await expect(pdf.locator("canvas").first()).toBeVisible();
  expect(await pdf.evaluate(e => e.clientHeight)).toBeGreaterThan(100);
  expect(await pdf.evaluate(e => e.clientHeight)).toBeLessThan(await page.evaluate(() => innerHeight));
  await pdf.focus(); await pdf.press("PageDown");
  await expect.poll(() => pdf.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".document-preview-pane__viewport").evaluate(e => e.scrollHeight - e.clientHeight)).toBe(0);
});
