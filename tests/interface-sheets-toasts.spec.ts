import { expect, test, type Locator, type Page } from "@playwright/test";

// Phone pickers are bottom sheets titled with the field they were opened
// from; toasts never cover a full-screen form's fields or its footer.
test.setTimeout(90_000);

const width = (page: Page) => page.viewportSize()?.width ?? 1440;
/** Pickers and long menus are bottom sheets at these widths. */
const usesSheets = (page: Page) => width(page) <= 560;

type Box = { top: number; bottom: number; left: number; right: number };

async function rect(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });
}

function overlaps(a: Box, b: Box) {
  return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

/** True when the control's centre hit-tests to the control itself. */
async function isOnTop(control: Locator) {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && element.contains(hit));
  });
}

/** The on-screen keyboard as iOS reports it: the visual viewport shrinks. */
async function openKeyboard(page: Page) {
  const keyboard = width(page) <= 320 ? 290 : width(page) <= 560 ? 336 : 400;
  await page.evaluate((kb) => {
    const viewport = window.visualViewport!;
    const visible = window.innerHeight - kb;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => visible });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 0 });
    viewport.dispatchEvent(new Event("resize"));
  }, keyboard);
  return page.evaluate(() => window.visualViewport!.height);
}

async function expectSheetHeader(page: Page, sheet: Locator, title: string) {
  await expect(sheet).toBeVisible();
  const heading = sheet.getByRole("heading", { name: title, exact: true });
  await expect(heading).toBeVisible();
  await expect(sheet.locator(".sheet-head").getByRole("button", { name: "Close", exact: true })).toBeVisible();
  // Measure once the sheet has slid into place.
  await sheet.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  const geometry = await sheet.evaluate((element) => {
    const box = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
    return { grabber: box(".sheet-grabber"), title: box(".sheet-head__title"), close: box(".sheet-head__close") };
  });
  // Under the grabber: the title, with a full-size close button beside it.
  expect(geometry.close.width).toBeGreaterThanOrEqual(43.5);
  expect(geometry.close.height).toBeGreaterThanOrEqual(43.5);
  expect(geometry.close.left).toBeGreaterThanOrEqual(geometry.title.right - 1);
  expect(Math.abs((geometry.close.top + geometry.close.bottom) / 2 - (geometry.title.top + geometry.title.bottom) / 2)).toBeLessThan(4);
  expect(geometry.grabber.bottom).toBeLessThanOrEqual(geometry.title.top + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width(page) + 1);
}

test("the guided-setup province picker is titled with its field on phones", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/setup");
  const start = page.getByRole("button", { name: /Start a new organization/i });
  const incorporation = page.getByRole("button", { name: "No, prepare a new incorporation", exact: true });
  await expect(start.or(incorporation).first()).toBeVisible({ timeout: 60_000 });
  if (await start.isVisible()) await start.click();
  await incorporation.click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^Provincially or territorially/ }).click();
  const trigger = page.getByLabel("Province or territory", { exact: true });
  await trigger.click();

  if (!usesSheets(page)) {
    // Desktop and tablet keep the anchored list, with no sheet header.
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.locator(".sheet-head")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Province or territory", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    return;
  }

  const sheet = page.getByRole("dialog", { name: "Province or territory", exact: true });
  await expectSheetHeader(page, sheet, "Province or territory");
  // The pinned search field sits under the title; the list is named by it too.
  const search = sheet.getByPlaceholder("Search…");
  await expect(search).toBeVisible();
  const headingBox = await rect(sheet.getByRole("heading", { name: "Province or territory", exact: true }));
  // (Settled: expectSheetHeader waited for the sheet's animation.)
  expect((await rect(search)).top).toBeGreaterThanOrEqual(headingBox.bottom - 1);
  const list = page.getByRole("listbox", { name: "Province or territory", exact: true });
  await expect(list.getByRole("option", { name: /^Ontario/ })).toBeVisible();
  // Header and search stay together at the top while the options scroll.
  const sheetTop = (await rect(sheet)).top;
  // (Whichever scrolls — the sheet or its list — the header must not move.)
  const scrolled = () => sheet.evaluate((element) => {
    const list = element.querySelector(".menu__list")!;
    return element.scrollTop + list.scrollTop;
  });
  await sheet.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const list = element.querySelector(".menu__list")!;
    list.scrollTop = list.scrollHeight;
  });
  await expect.poll(scrolled).toBeGreaterThan(0);
  expect(Math.abs((await rect(sheet.locator(".sheet-head"))).top - sheetTop)).toBeLessThan(2);
  await expect(sheet.getByRole("heading", { name: "Province or territory", exact: true })).toBeInViewport();
  await expect(search).toBeInViewport();
  // Close hands focus back to the field.
  await sheet.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test("pickers inside a drawer are titled with their field labels", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/members");
  await page.getByRole("button", { name: "New member", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add member", exact: true });
  await expect(drawer).toBeVisible();

  const province = drawer.getByLabel("Province / state", { exact: true });
  await province.click();
  if (!usesSheets(page)) {
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.locator(".sheet-head")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeVisible();
    expect(errors).toEqual([]);
    return;
  }
  const provinceSheet = page.getByRole("dialog", { name: "Province / state", exact: true });
  await expectSheetHeader(page, provinceSheet, "Province / state");
  // A long list is searchable on a phone sheet.
  await provinceSheet.getByPlaceholder("Search…").fill("scot");
  await page.getByRole("option", { name: "Nova Scotia", exact: true }).click();
  await expect(provinceSheet).toBeHidden();
  await expect(province).toContainText("Nova Scotia");
  await expect(drawer).toBeVisible();

  // The calendar sheet is titled the same way.
  await drawer.getByLabel("Joined", { exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "Joined", exact: true });
  await expectSheetHeader(page, calendar, "Joined");
  await calendar.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
  await expect(calendar).toBeHidden();
  await expect(drawer).toBeVisible();
  expect(errors).toEqual([]);
});

test("a toast with Undo stays clear of a drawer form's footer and focused field", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/financials?tab=transactions");
  await page.locator(".record-table__identifier-button").first().click();
  const panel = page.locator(".transaction-panel").first();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const mark = panel.getByRole("button", { name: "Mark reviewed", exact: true });
  for (let step = 0; step < 10 && !(await mark.isVisible()); step++) {
    await panel.getByRole("button", { name: "Next transaction", exact: true }).click();
  }
  await mark.click();
  const toast = page.locator(".toast", { hasText: "Marked as reviewed" });
  await expect(toast).toBeVisible();
  const undo = toast.getByRole("button", { name: "Undo", exact: true });

  // Typing a note while the toast is up.
  const notes = panel.locator("textarea.transaction-panel__notes");
  await notes.click();
  await expect(notes).toBeFocused();
  const footer = panel.locator(".drawer__footer");
  const footerButton = footer.getByRole("button", { name: "Copy link", exact: true });
  await expect.poll(async () => overlaps(await rect(toast), await rect(footer))).toBe(false);
  expect(overlaps(await rect(toast), await rect(notes))).toBe(false);
  // None of the form is under it: it covers neither the body nor the footer.
  expect(overlaps(await rect(toast), await rect(panel.locator(".drawer__body")))).toBe(false);
  expect(await isOnTop(footerButton)).toBe(true);
  expect(await isOnTop(notes)).toBe(true);
  expect(await isOnTop(undo)).toBe(true);

  if (width(page) <= 768) {
    // With the keyboard up the toast stays in the visible area, off the field.
    const visible = await openKeyboard(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard-open"))).toBe(true);
    await expect.poll(async () => (await rect(toast)).bottom).toBeLessThanOrEqual(visible);
    const toastBox = await rect(toast);
    expect(toastBox.top).toBeGreaterThanOrEqual(0);
    expect(overlaps(toastBox, await rect(notes))).toBe(false);
    expect(overlaps(toastBox, await rect(footer))).toBe(false);
  }
  await testInfo.attach("toast-over-drawer", { body: await page.screenshot(), contentType: "image/png" });

  // The Undo is still a tap away and works.
  await undo.click();
  await expect(toast).toBeHidden();
  await expect(mark).toBeVisible();
  await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});
