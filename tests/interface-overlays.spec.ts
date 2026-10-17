import { expect, test, type Locator, type Page } from "@playwright/test";
import { pinnedRowActions, rowActionsArePinned, runRowAction } from "./helpers/rowActions";

/** The first filing row that still offers "Mark filed". */
function unfiledRow(page: Page) {
  return page.locator(".record-table__row").filter({ has: page.locator("button", { hasText: "Mark filed" }) }).first();
}

// Layering, focus return, outside taps and the on-screen keyboard for the
// shared overlay components (dock, drawers, modals, menus, pickers, AI panel).
test.setTimeout(90_000);

const width = (page: Page) => page.viewportSize()?.width ?? 1440;
/** Pickers and long menus are bottom sheets at these widths. */
const usesSheets = (page: Page) => width(page) <= 560;
const isTouch = (page: Page) => width(page) < 980;

/** Keyboard heights the audit measured: phones 290/336px, tablet 400px. */
function keyboardHeight(page: Page) {
  const w = width(page);
  return w <= 320 ? 290 : w <= 560 ? 336 : 400;
}

/**
 * Simulate the on-screen keyboard the way iOS reports it: the visual
 * viewport shrinks while the layout viewport keeps its height.
 */
async function openKeyboard(page: Page, height = keyboardHeight(page)) {
  await page.evaluate((kb) => {
    const viewport = window.visualViewport!;
    const visible = window.innerHeight - kb;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => visible });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 0 });
    viewport.dispatchEvent(new Event("resize"));
  }, height);
  return page.evaluate(() => window.visualViewport!.height);
}

/** True when the control's centre hit-tests to the control itself. */
async function isOnTop(control: Locator) {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && element.contains(hit));
  });
}

async function tapOrClick(page: Page, x: number, y: number) {
  if (isTouch(page)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function openMemberPanel(page: Page) {
  await page.goto("/demo/app/members?record=static_member_mina");
  const panel = page.locator(".record-side-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

test("the minimised record dock stays under a drawer and its Save button", async ({ page }) => {
  const panel = await openMemberPanel(page);
  await panel.getByRole("button", { name: "Minimise" }).click();
  const dock = page.getByRole("region", { name: "Minimised record panel" });
  await expect(dock).toBeVisible();
  // The dock names the record, not just its type.
  await expect(dock.locator(".record-panel-dock__restore")).toHaveAccessibleName("Restore Mina Patel");

  await page.getByRole("button", { name: "New member", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add member", exact: true });
  await expect(drawer).toBeVisible();
  const save = drawer.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeVisible();
  await expect.poll(() => isOnTop(save)).toBe(true);
  await expect.poll(() => isOnTop(drawer.getByRole("button", { name: "Cancel", exact: true }))).toBe(true);
});

test("Esc in a panel's menu closes only the menu and returns focus to its trigger", async ({ page }) => {
  const panel = await openMemberPanel(page);
  const options = panel.getByRole("button", { name: /Options/ });
  await options.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Focus moves into the menu and the arrow keys move it.
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(options).toBeFocused();

  // Tab closes the menu instead of leaving it open behind the focus.
  await options.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(panel).toBeVisible();

  // Picking an item also lands focus back on the trigger.
  await options.click();
  await menu.getByRole("menuitem", { name: "Copy link" }).click();
  await expect(menu).toHaveCount(0);
  await expect(options).toBeFocused();
});

test("a calendar opened from the range picker dims the panel under it", async ({ page }) => {
  test.skip(!usesSheets(page), "Phones stack the range picker and its calendar as sheets");
  await page.goto("/demo/app/tasks");
  await page.getByRole("button", { name: "Filter" }).first().click();
  await page.getByRole("button", { name: "Choose field…" }).first().click();
  await page.getByRole("option", { name: /^Due/ }).first().click();
  const rangeTrigger = page.locator(".date-range-picker .select-trigger").first();
  await rangeTrigger.click();
  const range = page.locator(".date-range-picker__panel");
  await expect(range).toBeVisible();
  const start = range.locator(".date-range-picker__field .select-trigger").first();
  await start.click();
  // The calendar sheet is titled with the field it was opened from.
  const calendar = page.getByRole("dialog", { name: "Start date", exact: true });
  await expect(calendar).toBeVisible();

  const preset = range.locator(".date-range-picker__preset").first();
  const box = (await preset.boundingBox())!;
  const hit = await page.evaluate(([x, y]) => {
    const element = document.elementFromPoint(x, y);
    return element ? element.className : null;
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toContain("menu-backdrop");

  // Tapping the dimmed panel closes only the calendar; no preset is applied.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(calendar).toBeHidden();
  await expect(range).toBeVisible();
  await expect(start).toBeFocused();
  await expect(rangeTrigger).not.toContainText("Today");
});

test("an outside tap closes an anchored select inside a modal but keeps the modal", async ({ page }) => {
  await page.goto("/demo/app/filings");
  await runRowAction(unfiledRow(page), "Mark filed");
  const modal = page.getByRole("dialog", { name: "Mark filing as filed" });
  await expect(modal).toBeVisible();
  const method = modal.getByRole("button", { name: "Submission method", exact: true });
  await method.click();
  const options = page.getByRole("listbox");
  await expect(options).toBeVisible();
  await expect(options).not.toHaveClass(/menu--sheet/);

  // A point on the dimmed backdrop, above or beside the dialog.
  const box = (await modal.boundingBox())!;
  const viewport = page.viewportSize()!;
  // (A phone sheet leaves a 24px strip above it; a desktop dialog a wide margin.)
  const point = box.y >= 16
    ? { x: viewport.width / 2, y: box.y / 2 }
    : { x: box.x / 2, y: viewport.height / 2 };
  await tapOrClick(page, point.x, point.y);
  await expect(options).toBeHidden();
  await expect(modal).toBeVisible();
  // The next backdrop tap is the user's own and closes the modal.
  await tapOrClick(page, point.x, point.y);
  await expect(modal).toBeHidden();
});

test("closing a confirm by Esc or Cancel returns focus to the control that opened it", async ({ page }) => {
  await page.goto("/demo/app/filings");
  const row = page.locator(".record-table__row").filter({ has: page.locator('button[aria-label="Delete filing"]') }).first();
  // A table wider than its frame runs the delete from the pinned "Row
  // actions" menu, which hands focus back to that button.
  const del = await rowActionsArePinned(row) ? pinnedRowActions(row) : row.getByRole("button", { name: "Delete filing" });
  await runRowAction(row, "Delete filing");
  const confirm = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Cancel" }) }).last();
  await expect(confirm).toBeVisible();
  // The confirm opens on its action, not on the header Close button.
  await expect(confirm.locator(".modal__foot .btn").last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(del).toBeFocused();

  await runRowAction(row, "Delete filing");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(del).toBeFocused();
});

test("a select returns focus to its trigger when it closes", async ({ page }) => {
  await page.goto("/demo/app/members");
  await page.getByRole("button", { name: "New member", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add member", exact: true });
  await expect(drawer).toBeVisible();
  const province = drawer.getByLabel("Province / state", { exact: true });
  await province.scrollIntoViewIfNeeded();
  await province.click();
  const options = page.getByRole("listbox");
  await expect(options).toBeVisible();
  if (usesSheets(page)) {
    // Phone: a tap on the dimmed backdrop above the sheet.
    const sheet = (await options.boundingBox())!;
    await page.touchscreen.tap(page.viewportSize()!.width / 2, Math.max(4, sheet.y / 2));
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(options).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(province).toBeFocused();
});

test("the AI assistant returns focus to its trigger when it closes", async ({ page }) => {
  test.skip(isTouch(page), "The phone and tablet trigger lives in the navigation sheet, which closes as the assistant opens");
  await page.goto("/demo/app/members");
  const trigger = page.getByRole("button", { name: "AI assistant", exact: true }).first();
  await trigger.click();
  const assistant = page.getByRole("dialog", { name: "Societyer AI assistant" });
  await expect(assistant).toBeVisible();
  await expect(assistant.locator("textarea")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(assistant).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(assistant).toBeVisible();
  await assistant.getByRole("button", { name: "Close AI assistant" }).last().click();
  await expect(assistant).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("a drawer keeps its footer above the on-screen keyboard", async ({ page }) => {
  test.skip(!isTouch(page), "Only touch screens raise an on-screen keyboard");
  await page.goto("/demo/app/tasks");
  await page.getByRole("button", { name: "New task" }).first().click();
  const drawer = page.getByRole("dialog", { name: "New task" });
  await expect(drawer).toBeVisible();
  const title = drawer.getByRole("textbox").first();
  await title.focus();
  const visible = await openKeyboard(page);
  const create = drawer.getByRole("button", { name: "Create", exact: true });
  await expect.poll(async () => {
    const box = await create.boundingBox();
    return box ? box.y + box.height : Infinity;
  }).toBeLessThanOrEqual(visible + 1);
  await expect.poll(() => isOnTop(drawer.getByRole("button", { name: "Cancel", exact: true }))).toBe(true);
  const titleBox = (await title.boundingBox())!;
  expect(titleBox.y).toBeGreaterThanOrEqual(0);
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(visible);
});

test("a modal keeps the focused field and its footer above the on-screen keyboard", async ({ page }) => {
  test.skip(!isTouch(page), "Only touch screens raise an on-screen keyboard");
  await page.goto("/demo/app/filings");
  await runRowAction(unfiledRow(page), "Mark filed");
  const modal = page.getByRole("dialog", { name: "Mark filing as filed" });
  await expect(modal).toBeVisible();
  const field = modal.locator(".modal__body input:visible").last();
  await field.focus();
  const visible = await openKeyboard(page);
  await expect.poll(async () => {
    const box = await field.boundingBox();
    return box ? box.y + box.height <= visible + 1 && box.y >= 0 : false;
  }).toBe(true);
  // Not hidden inside the scrolled body either.
  await expect.poll(() => isOnTop(field)).toBe(true);
  const save = modal.getByRole("button", { name: "Save", exact: true });
  await expect.poll(async () => {
    const box = await save.boundingBox();
    return box ? box.y + box.height : Infinity;
  }).toBeLessThanOrEqual(visible + 1);
});

test("a prompt opened from a modal focuses its input and Esc closes only the prompt", async ({ page }) => {
  await page.goto("/demo/app/filings");
  await runRowAction(unfiledRow(page), "Mark filed");
  const modal = page.getByRole("dialog", { name: "Mark filing as filed" });
  await expect(modal).toBeVisible();
  const link = modal.getByRole("button", { name: "Link", exact: true });
  await link.scrollIntoViewIfNeeded();
  await link.click();
  const prompt = page.getByRole("dialog", { name: "Add link" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByPlaceholder("https://example.com")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(prompt).toBeHidden();
  await expect(modal).toBeVisible();
  // Focus is back inside the modal, not dropped on <body>.
  await expect.poll(() => modal.evaluate((element) => element.contains(document.activeElement))).toBe(true);
});

test("the minimised dock stays under the AI assistant, whose composer rides above the keyboard", async ({ page }) => {
  const panel = await openMemberPanel(page);
  await panel.getByRole("button", { name: "Minimise" }).click();
  await expect(page.getByRole("region", { name: "Minimised record panel" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("societyer-ai:open")));
  const assistant = page.getByRole("dialog", { name: "Societyer AI assistant" });
  await expect(assistant).toBeVisible();
  const composer = assistant.locator(".global-ai-composer textarea");
  await expect(composer).toBeVisible();
  await expect.poll(() => isOnTop(composer)).toBe(true);
  if (!isTouch(page)) return;
  // Header buttons are full touch targets on touch screens.
  const close = assistant.locator(".global-ai-drawer__head").getByRole("button", { name: "Close AI assistant" });
  const box = (await close.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);

  await composer.focus();
  const visible = await openKeyboard(page);
  await expect.poll(async () => {
    const rect = await composer.boundingBox();
    return rect ? rect.y + rect.height : Infinity;
  }).toBeLessThanOrEqual(visible + 1);
});

/** A touch drag from (x, y) straight down by `distance` px, via CDP. */
async function touchDrag(page: Page, x: number, y: number, distance: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (distance * step) / 10 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("a phone form sheet swipes away only from its grabber or header", async ({ page }) => {
  test.skip(!usesSheets(page), "Phones show modals as swipeable sheets");
  await page.goto("/demo/app/filings");
  await runRowAction(unfiledRow(page), "Mark filed");
  const modal = page.getByRole("dialog", { name: "Mark filing as filed" });
  await expect(modal).toBeVisible();
  await page.waitForTimeout(400);
  // A long downward drag on the form's body scrolls it; the sheet stays.
  const body = (await modal.locator(".modal__body").boundingBox())!;
  await touchDrag(page, body.x + body.width / 2, body.y + 40, 300);
  await page.waitForTimeout(500);
  await expect(modal).toBeVisible();
  // The same drag on the header dismisses it.
  const head = (await modal.locator(".modal__head").boundingBox())!;
  await touchDrag(page, head.x + 40, head.y + head.height / 2, 300);
  await expect(modal).toBeHidden();
});

test("Save as on a record table view opens on its name field, so a typed space stays in the name", async ({ page }) => {
  test.skip(isTouch(page), "Typing straight into a prompt is a hardware keyboard flow");
  await page.goto("/demo/app/deadlines");
  await page.locator(".record-table__row").first().waitFor();
  // Sorting makes the view unsaved, which offers Save as.
  await page.locator(".record-table__header-cell, th").filter({ hasText: /^Category/ }).first().click();
  await page.getByRole("button", { name: "Save as", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Save as a new view" });
  await expect(prompt).toBeVisible();
  const name = prompt.getByRole("textbox");
  await expect(name).toBeFocused();
  await page.keyboard.type("By category");
  await expect(prompt).toBeVisible();
  await expect(name).toHaveValue("By category");
  await page.keyboard.press("Enter");
  await expect(prompt).toBeHidden();
  await expect(page.locator(".record-table__toolbar").first()).toContainText("By category");
});

test("task row menus close with Esc and take arrow keys and Enter", async ({ page }) => {
  test.skip(isTouch(page), "Keyboard flow");
  await page.goto("/demo/app/tasks");
  const status = page.getByRole("button", { name: /Change status/ }).first();
  await status.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(status).toBeFocused();

  await status.click();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem").last()).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
});

test("Esc while typing in a drawer leaves the field first, so its text is kept", async ({ page }) => {
  test.skip(isTouch(page), "Hardware keyboard flow");
  await page.goto("/demo/app/financials?tab=transactions");
  const rowOpener = page.locator(".record-table__identifier-button").first();
  await rowOpener.click();
  const panel = page.locator(".transaction-panel").first();
  await expect(panel).toBeVisible();
  const notes = panel.locator("textarea.transaction-panel__notes");
  const note = `Paid at the door ${Date.now()}`;
  await notes.fill(note);
  await page.keyboard.press("Escape");
  // The field saves on blur; the panel stays open.
  await expect(notes).not.toBeFocused();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await rowOpener.click();
  await expect(page.locator(".transaction-panel textarea.transaction-panel__notes").first()).toHaveValue(note);
});
