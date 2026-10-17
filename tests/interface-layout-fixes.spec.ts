import { expect, test, type Page } from "@playwright/test";

// Layout regressions from the layout audit: virtualised tables scroll
// sideways on desktop, the meeting template builder keeps its controls in
// the card, the row-actions column no longer swallows header clicks (and a
// table wider than its frame pins a compact "Row actions" button instead),
// and phone pages don't scroll sideways.

async function noPageSideways(page: Page) {
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    page: document.querySelector<HTMLElement>(".page")?.scrollWidth ?? 0,
    viewport: innerWidth,
  }));
  expect(widths.doc, "document scrolls sideways").toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.page, "page container scrolls sideways").toBeLessThanOrEqual(widths.viewport + 1);
}

test("a virtualised register scrolls sideways to its last column at 1024", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-width check");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/demo/app/members");
  const scroller = page.locator(".record-table__virtuoso").first();
  await expect(scroller).toBeVisible();
  const lastHeader = page.locator(".record-table__header-cell", { hasText: "Email" }).first();
  await expect(lastHeader).toBeVisible();

  const frame = await scroller.boundingBox();
  expect(frame).not.toBeNull();
  const before = await lastHeader.boundingBox();
  // The register is wider than its frame: Email starts out past the edge.
  expect(before!.x + before!.width).toBeGreaterThan(frame!.x + frame!.width);

  // A sideways wheel over the table scrolls the table itself.
  await page.mouse.move(frame!.x + frame!.width / 2, frame!.y + 200);
  await page.mouse.wheel(2000, 0);
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(async () => {
    const box = await lastHeader.boundingBox();
    return box ? box.x + box.width <= frame!.x + frame!.width + 1 : false;
  }).toBe(true);

  // Header and body stay aligned after the scroll.
  const header = await lastHeader.boundingBox();
  const firstEmail = await page.locator(".record-table__row").first().locator("td").nth(
    await lastHeader.evaluate((th) => Array.from(th.parentElement!.children).indexOf(th)),
  ).boundingBox();
  expect(Math.abs(header!.x - firstEmail!.x)).toBeLessThanOrEqual(1);
});

for (const width of [768, 1024]) {
  test(`meeting template builder keeps every agenda control in view at ${width}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "sized explicitly");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/demo/app/meeting-templates/static_meeting_template_board");
    const main = page.locator(".meeting-template-builder__main");
    await expect(main.getByRole("textbox", { name: "Presenter" }).first()).toBeVisible();

    const outside = await main.evaluate((card) => {
      const edge = card.getBoundingClientRect();
      return Array.from(card.querySelectorAll<HTMLElement>("button, input, textarea, .select-trigger"))
        .filter((control) => control.getClientRects().length > 0)
        .filter((control) => {
          const box = control.getBoundingClientRect();
          return box.right > edge.right + 1 || box.left < edge.left - 1;
        })
        .map((control) => control.getAttribute("aria-label") || control.textContent?.trim() || control.tagName);
    });
    expect(outside, "controls past the agenda card's edge").toEqual([]);
    expect(await main.evaluate((card) => card.scrollWidth <= card.clientWidth + 1)).toBe(true);

    // The row's own controls take input and clicks.
    const presenter = main.getByRole("textbox", { name: "Presenter" }).first();
    await presenter.fill(`Chair ${width}`);
    await expect(presenter).toHaveValue(`Chair ${width}`);
    await expect(main.getByRole("button", { name: "Remove agenda item" }).first()).toBeInViewport();
    await expect(main.getByRole("button", { name: "Add sub-item" }).first()).toBeVisible();
  });
}

test("the Updated header sorts on click at 1024 (row actions don't swallow it)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-width check");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/demo/app/meeting-templates");
  const updated = page.getByRole("columnheader", { name: "Updated" });
  await expect(updated).toBeVisible();
  await expect(updated).toHaveAttribute("aria-sort", "none");
  // A real pointer click: Playwright refuses if another element (the old
  // sticky actions header) sits on top of the button.
  await updated.locator(".record-table__header-cell-button").click({ timeout: 5_000 });
  await expect(updated).toHaveAttribute("aria-sort", "ascending");

  // Hovering a row doesn't paint its actions over the row's values: the
  // pinned 40px cell only sits over a column that runs on past the frame's
  // edge (reachable by scrolling), and none once scrolled to the end.
  const row = page.locator(".record-table__row").first();
  await row.hover();
  const coveredInView = () => row.evaluate((tr) => {
    const actions = tr.querySelector(".record-table__row-actions-cell")?.getBoundingClientRect();
    const frame = tr.closest(".record-table__scroll, .record-table__virtuoso")!.getBoundingClientRect();
    if (!actions) return [];
    return Array.from(tr.querySelectorAll<HTMLElement>("td.record-table__cell"))
      .filter((cell) => {
        const box = cell.getBoundingClientRect();
        return box.right > actions.left + 1 && box.left < actions.right - 1 && box.right <= frame.right + 1;
      })
      .map((cell) => cell.textContent?.trim());
  });
  expect(await coveredInView(), "visible data cells under the row actions").toEqual([]);
  await page.locator(".record-table__scroll").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await row.hover();
  const coveredAtEnd = await row.evaluate((tr) => {
    const actions = tr.querySelector(".record-table__row-actions-cell")!.getBoundingClientRect();
    return Array.from(tr.querySelectorAll<HTMLElement>("td.record-table__cell"))
      .filter((cell) => cell.getBoundingClientRect().right > actions.left + 1)
      .map((cell) => cell.textContent?.trim());
  });
  expect(coveredAtEnd, "data cells under the row actions at the end of the row").toEqual([]);
});

test("a table wider than its frame pins a Row actions button with every action at 1024", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "mouse layout at an explicit width");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/demo/app/meeting-templates");
  const scroller = page.locator(".record-table__scroll");
  const row = page.locator(".record-table__row", { hasText: "Annual general meeting" });
  const more = row.getByRole("button", { name: "Row actions for Annual general meeting" });
  await expect(more).toBeVisible();
  // In view with the table at its start: no sideways scrolling needed.
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth && el.scrollLeft === 0)).toBe(true);
  await expect(more).toBeInViewport({ ratio: 1 });
  const inFrame = await more.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const frame = button.closest(".record-table__scroll")!.getBoundingClientRect();
    return box.left >= frame.left && box.right <= frame.right + 1;
  });
  expect(inFrame, "row actions button inside the table frame").toBe(true);
  // The wide inline buttons are out of sight (and out of the tab order).
  await expect(row.getByRole("button", { name: "Schedule meeting" })).toBeHidden();
  // The pinned cell is opaque, so scrolled columns never show through.
  const background = await row.locator(".record-table__row-actions-cell").evaluate((cell) => getComputedStyle(cell).backgroundColor + getComputedStyle(cell).backgroundImage);
  expect(background).not.toMatch(/^rgba\(0, 0, 0, 0\)none$/);

  await more.click();
  const menu = page.getByRole("menu", { name: "Actions for Annual general meeting" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Schedule meeting" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
  // The menu runs the row's own action.
  await menu.getByRole("menuitem", { name: "Schedule meeting" }).click();
  await expect(page.getByRole("dialog").first()).toBeVisible();
});

test("the row actions stay inline when the table fits its frame", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "1440 fits the meeting templates table");
  await page.goto("/demo/app/meeting-templates");
  const row = page.locator(".record-table__row", { hasText: "Annual general meeting" });
  await row.hover();
  await expect(row.getByRole("button", { name: "Schedule meeting" })).toBeVisible();
  await expect(row.getByRole("button", { name: /^Row actions for/ })).toBeHidden();
  const scroller = page.locator(".record-table__scroll");
  expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test("touch keeps the inline row actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet", "coarse pointer");
  await page.goto("/demo/app/filings");
  const row = page.locator(".record-table__row").filter({ has: page.getByRole("button", { name: "Mark filed" }) }).first();
  await expect(row.getByRole("button", { name: "Mark filed" })).toBeVisible();
  await expect(row.getByRole("button", { name: /^Row actions for/ })).toBeHidden();
});
