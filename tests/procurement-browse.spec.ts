import { expect, test, type Page } from "@playwright/test";

/** The hosted list's endless scroll (tests/fixtures/procurement-browse.html): pages arrive ahead of the reader; a button appears only when a filter stops matching. */
/** The list's last row, read without waiting: a virtualized footer is only in the page while it's near the view. */
const footerText = (page: Page) => page.evaluate(() => document.querySelector(".record-table__list-footer-content, .record-cards__footer, .record-table__empty-action")?.textContent ?? "");
const requests = (page: Page) => page.evaluate(() => (window as unknown as { __pageRequests: (string | null)[] }).__pageRequests.length);

async function scrollToEnd(page: Page) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll(".record-table__virtuoso, .page")) element.scrollTop = element.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
}

test("scrolling loads every page with no button, and says when the results end", async ({ page }) => {
  await page.goto("/tests/fixtures/procurement-browse.html");
  await expect(page.getByText("Synthetic award 0", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /load more/i })).toHaveCount(0);
  await expect.poll(async () => {
    await scrollToEnd(page);
    return footerText(page);
  }, { timeout: 15_000 }).toContain("400 results · end of results");
  expect(await requests(page)).toBe(8);
  await expect(page.getByRole("button", { name: /keep checking|load more/i })).toHaveCount(0);
});

test("the next page is requested before the reader reaches the last row", async ({ page, isMobile }) => {
  test.skip(isMobile, "Cards load against the page scroller; the look-ahead is the table's");
  await page.goto("/tests/fixtures/procurement-browse.html");
  await expect(page.getByText("Synthetic award 0", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  expect(await requests(page)).toBe(1);
  // Scroll until the second page is asked for: the last row of the first page must not have come into view yet.
  let lastRowSeen = false;
  for (let step = 0; step < 40 && (await requests(page)) < 2; step++) {
    await page.locator(".record-table__virtuoso").evaluate((scroller) => { scroller.scrollTop += 100; });
    await page.waitForTimeout(50);
    lastRowSeen ||= await page.getByText("Synthetic award 49", { exact: true }).isVisible() && await page.getByText("Synthetic award 49", { exact: true }).evaluate((row) => {
      const view = row.closest(".record-table__virtuoso")!.getBoundingClientRect(), box = row.getBoundingClientRect();
      return box.top < view.bottom;
    });
  }
  expect(await requests(page)).toBe(2);
  expect(lastRowSeen, "The next page was requested before the first page's last row scrolled into view").toBe(false);
});

test("a search that stops matching keeps reading on its own, then asks before reading further", async ({ page }) => {
  await page.goto("/tests/fixtures/procurement-browse.html?q=nomatch");
  const keepChecking = page.getByRole("button", { name: "Keep checking" });
  await expect(keepChecking).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("The next 1,000 notices didn't match.")).toBeVisible();
  // One initial page, then auto-continued pages up to the 1,000-notice budget (100 a page).
  expect(await requests(page)).toBe(10);
  await keepChecking.click();
  await expect(keepChecking).toBeVisible({ timeout: 15_000 });
  expect(await requests(page)).toBe(20);
});

test("a minute passing keeps the rows already loaded", async ({ page, isMobile }) => {
  test.skip(isMobile, "The table's own scroller is the desktop path");
  await page.clock.install();
  await page.goto("/tests/fixtures/procurement-browse.html");
  await page.clock.runFor(2_000);
  await expect(page.getByText("Synthetic award 0", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.locator(".record-table__virtuoso").evaluate((scroller) => { scroller.scrollTop = scroller.scrollHeight; });
  await page.clock.runFor(1_000);
  const count = page.locator(".record-table__view-count").first();
  await expect(count).toHaveText("100");
  const loaded = await requests(page);
  // The clock moves every minute (relative dates, closing status). Loaded pages stay, and nothing reloads from the top.
  await page.clock.runFor(61_000);
  await expect(count).toHaveText("100");
  await expect(page.locator(".record-table__virtuoso tbody tr").first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pageRequests: (string | null)[] }).__pageRequests.slice(-1)[0])).not.toBeNull();
  expect(await requests(page)).toBe(loaded);
});

test("the header stays on top of the rows scrolling under it", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones show cards, not a table header");
  await page.goto("/tests/fixtures/procurement-browse.html");
  await expect(page.getByText("Synthetic award 0", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  const scroller = page.locator(".record-table__virtuoso");
  // Every header cell must be what a click on it reaches, wherever the rows are: mid-list, then the end of a grown list.
  const coveredHeaders = () => page.evaluate(() => [...document.querySelectorAll(".record-table__virtuoso thead th")].flatMap((cell) => {
    const box = cell.getBoundingClientRect();
    // An empty, click-through header (the row actions column's) is hit-tested past on purpose.
    if (box.width < 4 || getComputedStyle(cell).pointerEvents === "none") return [];
    const hit = document.elementFromPoint(box.left + Math.min(20, box.width / 2), box.top + box.height / 2);
    return hit && cell.contains(hit) ? [] : [`${cell.textContent?.trim() || "(blank)"} ← ${hit?.closest("td")?.textContent?.trim().slice(0, 30) ?? hit?.tagName}`];
  }));
  for (const position of [600, 1200]) {
    await scroller.evaluate((element, top) => { element.scrollTop = top; }, position);
    await page.waitForTimeout(300);
    expect(await coveredHeaders(), `scrollTop ${position}`).toEqual([]);
  }
  for (let step = 0; step < 4; step++) {
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(400);
    expect(await coveredHeaders(), `end of the list, step ${step}`).toEqual([]);
  }
});
