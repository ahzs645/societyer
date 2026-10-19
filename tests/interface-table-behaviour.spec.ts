import { expect, test, type Page } from "@playwright/test";
import { chooseViewType, revealSelectRecords } from "./helpers/recordTableToolbar";

/**
 * Table behaviour regressions from the tables audit: inline edits survive a
 * click or tap elsewhere, bulk actions only reach rows on screen, clearing a
 * cell can be undone, kanban drops out of the current tab stay visible, and
 * phones can select tasks and table rows (including by long-press).
 */

const isPhone = (name: string) => name === "phone" || name === "narrow-phone";

/** A touch long-press through CDP (Playwright only offers taps). */
async function longPress(page: Page, x: number, y: number, ms = 700) {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

test("an outside click or tap saves an open inline cell edit; Escape still cancels", async ({ page }, testInfo) => {
  test.skip(!["desktop", "phone"].includes(testInfo.project.name), "desktop click and phone tap cover the two paths");
  const phone = isPhone(testInfo.project.name);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Phones list members as cards, so the tap path runs on a register that
  // stays an editable table on phones (Court orders' court; the phone column
  // cap keeps the title, the status and the next column, Court).
  await page.goto(phone ? "/demo/app/court-orders" : "/demo/app/members");
  const cells = page.locator(`td[data-field-name="${phone ? "court" : "lastName"}"]`);
  const cell = cells.first();
  await expect(cell).toBeVisible();
  const before = (await cell.innerText()).trim();
  const edited = `${before}Zed`;

  const open = async () => {
    if (phone) await cell.tap();
    else await cell.dblclick();
    const input = page.locator(".record-table__cell-editor-popover input").first();
    await expect(input).toBeFocused();
    return input;
  };

  // Escape throws the draft away.
  let input = await open();
  await input.fill(`${before}Nope`);
  await input.press("Escape");
  await expect(page.locator(".record-table__cell-editor-popover")).toHaveCount(0);
  await expect(cells.filter({ hasText: `${before}Nope` })).toHaveCount(0);

  // Clicking or tapping the page title (outside the table) saves it.
  input = await open();
  await input.fill(edited);
  const title = page.getByRole("heading", { level: 1 }).first();
  if (phone) await title.tap();
  else await title.click();
  await expect(page.locator(".record-table__cell-editor-popover")).toHaveCount(0);
  // Shown at once (pending), then saved.
  await expect(cells.filter({ hasText: edited })).toHaveCount(1);
  await expect(cells.filter({ hasText: edited }).first()).not.toHaveAttribute("aria-busy", "true", { timeout: 8000 });
  await expect(cells.filter({ hasText: edited })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("outside-save.png") });
  expect(errors).toEqual([]);
});

test("bulk actions and their count follow the search; Escape clears the selection", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the selection column shows on wide screens");
  await page.goto("/demo/app/members");
  const rows = page.locator("tr.record-table__row");
  await expect(rows.nth(3)).toBeVisible();
  const lastNameOf = async (index: number) => (await rows.nth(index).locator('td[data-field-name="lastName"]').innerText()).trim();
  const first = await lastNameOf(0);
  const third = await lastNameOf(2);
  test.skip(!first || !third || first === third, "needs distinct surnames in the seed");

  await rows.nth(0).getByRole("checkbox", { name: "Select row" }).check();
  await rows.nth(1).getByRole("checkbox", { name: "Select row" }).check();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar).toContainText("2 selected");

  // A search that hides both ticked rows hides the island: nothing on
  // screen is selected, so nothing can be archived unseen.
  const search = page.getByPlaceholder("Search members…");
  await search.fill(third);
  await expect(bar).toHaveCount(0);
  const header = page.getByRole("checkbox", { name: /Select all rows|Deselect all rows/ });
  await expect(header).not.toBeChecked();

  // Showing one of them again counts only that one; actions get only it.
  await search.fill(first);
  await expect(bar).toContainText("1 selected");
  await search.fill("");
  await expect(bar).toContainText("2 selected");
  // Some but not all rows selected: the header checkbox is mixed.
  expect(await header.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(true);

  await page.getByRole("heading", { level: 1 }).first().click();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("Delete on a focused cell clears it at once and Undo restores it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "keyboard path");
  await page.goto("/demo/app/members");
  const cell = page.locator('td[data-field-name="lastName"]').first();
  await expect(cell).toBeVisible();
  const before = (await cell.innerText()).trim();
  await cell.click();
  await expect(page.locator("td.record-table__cell--focused")).toHaveCount(1);
  await page.keyboard.press("Delete");

  // Optimistic: the focused cell (which follows its record) is empty now.
  await expect(page.locator("td.record-table__cell--focused")).not.toContainText(before, { timeout: 600 });
  const toast = page.locator(".toast", { hasText: "Cleared last name" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('td[data-field-name="lastName"]', { hasText: before }).first()).toBeVisible();
});

test("a kanban drop onto a status the tab hides keeps the card and explains the move", async ({ page }, testInfo) => {
  test.skip(!["desktop", "phone"].includes(testInfo.project.name), "mouse drag and the touch move menu");
  const phone = isPhone(testInfo.project.name);
  await page.goto("/demo/app/deadlines");
  await chooseViewType(page, "Kanban view");
  const column = (label: string) => page.locator(".kanban__col", { has: page.locator(".kanban__head", { hasText: label }) });
  const card = column("Open").locator(".kanban__card").first();
  await expect(card).toBeVisible();
  await expect(column("Complete").locator(".kanban__card")).toHaveCount(0);

  if (phone) {
    await card.getByRole("button", { name: "Move to column" }).tap();
    await page.getByRole("menuitem", { name: "Complete", exact: true }).tap();
  } else {
    await card.dragTo(column("Complete").locator(".kanban__body"));
  }

  // Still on screen, in its new column, with an explanation, Undo and Show.
  const moved = column("Complete").locator(".kanban__card");
  await expect(moved).toHaveCount(1);
  const title = (await moved.locator(".record-table__board-card-title").innerText()).trim();
  // (A recurring deadline also spawns its next occurrence in Open, so the
  // same title may reappear there.)
  expect(title.length).toBeGreaterThan(0);
  const toast = page.locator(".toast", { hasText: "Deadline completed" });
  await expect(toast).toContainText("Not in Open any more");
  await expect(toast.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("kanban-moved-out.png") });
  await toast.getByRole("button", { name: "Show", exact: true }).click();
  await expect(column("Complete").locator(".kanban__card", { hasText: title })).toBeVisible();
});

test("phones can select tasks from Options or by long-press, and reach bulk actions", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), "phone selection mode");
  await page.goto("/demo/app/tasks");
  const rows = page.locator(".task-row");
  await expect(rows.first()).toBeVisible();

  const toggle = await revealSelectRecords(page);
  await toggle.tap();
  const firstBox = rows.first().getByRole("checkbox");
  await expect(firstBox).toBeVisible();
  const box = await firstBox.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(16);
  // In selection mode a tap ticks the row instead of opening the task.
  await rows.nth(1).locator(".task-row__title-text").tap();
  await expect(rows.nth(1).getByRole("checkbox")).toBeChecked();
  await expect(page.getByRole("dialog", { name: "Edit task" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  await page.screenshot({ path: testInfo.outputPath("tasks-phone-selecting.png") });

  // A fresh page starts outside selection; a long-press on a row enters it.
  await page.goto("/demo/app/tasks");
  await expect(rows.first()).toBeVisible();
  const target = await rows.nth(2).locator(".task-row__title-text").boundingBox();
  if (!target) throw new Error("task row not laid out");
  await longPress(page, target.x + 10, target.y + target.height / 2);
  await expect(rows.nth(2).getByRole("checkbox")).toBeChecked();
  await expect(page.getByRole("dialog", { name: "Edit task" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
});

test("a long-press on a phone record card starts selection without opening the record", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), "touch long-press");
  // Phones list members as cards; a long-press selects, as on table rows.
  await page.goto("/demo/app/members");
  const cards = page.locator(".record-cards__item");
  const card = cards.nth(1);
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  if (!box) throw new Error("card not laid out");
  await longPress(page, box.x + box.width / 2, box.y + box.height / 2);
  await expect(card.getByRole("checkbox", { name: /^Deselect / })).toBeChecked();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Further taps tick cards rather than opening them.
  await cards.nth(2).tap();
  await expect(cards.nth(2).getByRole("checkbox", { name: /^Deselect / })).toBeChecked();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("2 selected");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
