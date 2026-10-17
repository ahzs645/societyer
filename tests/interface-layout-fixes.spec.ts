import { expect, test, type Page } from "@playwright/test";

// Layout regressions from the layout audit: virtualised tables scroll
// sideways on desktop, the meeting template builder keeps its controls in
// the card, the row-actions column no longer swallows header clicks (and a
// table wider than its frame pins a compact "Row actions" button instead),
// long plain tables keep their header in a box only when they need one, and
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

test("a short plain table has no inner scroll box", async ({ page }, testInfo) => {
  test.skip(!["desktop", "tablet"].includes(testInfo.project.name), "the cap applies from 761px");
  await page.goto("/demo/app/meeting-templates");
  const scroller = page.locator(".record-table__scroll");
  await expect(page.locator(".record-table__row").first()).toBeVisible();
  const box = await scroller.evaluate((el) => ({
    capped: el.hasAttribute("data-capped"),
    overflowY: getComputedStyle(el).overflowY,
    maxHeight: getComputedStyle(el).maxHeight,
    scrollable: el.scrollHeight > el.clientHeight,
  }));
  expect(box).toEqual({ capped: false, overflowY: "hidden", maxHeight: "none", scrollable: false });
});

test("a long plain table keeps its header in view and hands the wheel back to the page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "wheel scrolling");
  await page.goto("/demo/app/documents");
  const scroller = page.locator(".record-table__scroll");
  await expect(page.locator(".record-table__row").first()).toBeVisible();
  await expect(scroller).toHaveAttribute("data-capped", "");
  await scroller.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
  const pageScroller = page.locator(".page").first();
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));

  // Scrolling inside the box: the header stays pinned to its top.
  await page.mouse.wheel(0, 200);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const pinned = await scroller.evaluate((el) => {
    const head = el.querySelector(".record-table__thead")!.getBoundingClientRect();
    return Math.abs(head.top - el.getBoundingClientRect().top) <= 1;
  });
  expect(pinned, "header pinned to the top of the box").toBe(true);

  // At the box's end the wheel carries on to the page (no containment).
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const pageBefore = await pageScroller.evaluate((el) => el.scrollTop);
  const maxPage = await pageScroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(maxPage - pageBefore < 20, "the page has no room left to scroll");
  const at = (await scroller.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, Math.max(at.y + 60, Math.min(at.y + at.height - 60, 700)));
  await page.mouse.wheel(0, 300);
  await expect.poll(() => pageScroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(pageBefore);
  expect(await scroller.evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe("auto");
});

test("keyboard row navigation scrolls within a long table's box", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "keyboard path");
  await page.goto("/demo/app/documents");
  const scroller = page.locator(".record-table__scroll");
  await expect(scroller).toHaveAttribute("data-capped", "");
  await page.locator(".record-table__row").first().locator("td.record-table__cell").nth(1).click();
  const rows = await page.locator(".record-table__row").count();
  for (let i = 0; i < rows - 1; i += 1) await page.keyboard.press("ArrowDown");
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // The focused cell ends up in the box, clear of the sticky header and footer.
  await expect.poll(() => scroller.evaluate((el) => {
    const cell = el.querySelector<HTMLElement>(".record-table__cell--focused");
    if (!cell) return "no focused cell";
    const box = cell.getBoundingClientRect();
    const head = el.querySelector(".record-table__thead")!.getBoundingClientRect();
    const foot = el.querySelector("tfoot")?.getBoundingClientRect();
    return box.top >= head.bottom - 1 && box.bottom <= (foot ? foot.top : el.getBoundingClientRect().bottom) + 1 ? "visible" : "hidden";
  })).toBe("visible");
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
