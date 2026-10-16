import { expect, test, type Page } from "@playwright/test";

// Layout regressions from the layout audit: virtualised tables scroll
// sideways on desktop, the meeting template builder keeps its controls in
// the card, the row-actions column no longer swallows header clicks, and
// phone pages don't scroll sideways.

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

  // Hovering a row doesn't paint its actions over the row's values.
  const row = page.locator(".record-table__row").first();
  await row.hover();
  const covered = await row.evaluate((tr) => {
    const actions = tr.querySelector(".record-table__row-actions-cell")?.getBoundingClientRect();
    if (!actions) return [];
    return Array.from(tr.querySelectorAll<HTMLElement>("td.record-table__cell"))
      .filter((cell) => {
        const box = cell.getBoundingClientRect();
        return box.right > actions.left + 1 && box.left < actions.right - 1;
      })
      .map((cell) => cell.textContent?.trim());
  });
  expect(covered, "data cells under the row actions").toEqual([]);
});

for (const route of ["assets", "tasks"]) {
  test(`/${route} has no page-level sideways scroll at 320`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "narrow-phone", "320px check");
    await page.goto(`/demo/app/${route}`);
    await expect(page.locator(".main h1").first()).toBeVisible();
    if (route === "assets") await expect(page.locator(".record-cards__item").first()).toBeVisible();
    else await expect(page.locator(".task-row").first()).toBeVisible();
    await noPageSideways(page);

    // Phone header titles never break mid-word ("T a s k s").
    const title = page.locator(".page__title-text").first();
    const lines = await title.evaluate((el) => {
      const words = (el.textContent ?? "").trim().split(/\s+/).length;
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
      return { words, lines: Math.round(el.getBoundingClientRect().height / lineHeight) };
    });
    expect(lines.lines).toBeLessThanOrEqual(lines.words);

    if (route === "assets") {
      const overflowing = await page.locator(".record-cards__item").evaluateAll((cards) =>
        cards.filter((card) => card.getBoundingClientRect().right > innerWidth + 1).length,
      );
      expect(overflowing).toBe(0);
    }
  });
}
