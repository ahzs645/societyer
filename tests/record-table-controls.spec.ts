import { expect, test } from "@playwright/test";
import { MembersPage } from "./pom/membersPage";
import { RecordTablePage } from "./pom/recordTablePage";

test.describe("record table controls", () => {
  test("members table exposes Twenty-style search, sort, filter, and column controls", async ({ page }) => {
    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);
    await table.search("member");
    await table.openColumnsMenu();
    await page.keyboard.press("Escape");
    await table.openSortPopover();
    await expect(page.getByText("Sort records")).toBeVisible();
    await table.openFilterPopover();
    await expect(page.locator(".record-table__filter-popover")).toBeVisible();
  });

  test("members table supports keyboard focus movement and edit cancellation", async ({ page }) => {
    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);
    await table.focusCell(0, 1);
    await page.keyboard.press("ArrowRight");
    await table.expectFocusedCell(0, 2);
    await page.keyboard.press("ArrowDown");
    await table.expectFocusedCell(1, 2);
    await table.focusCell(0, 1);
    await table.enterEditMode();
    await page.keyboard.press("Escape");
    await table.expectNoFocusedCell();
  });

  test("members table exposes a hover action that opens the edit drawer", async ({ page }) => {
    const members = new MembersPage(page);
    await members.gotoDemo();

    const firstRow = page.locator(".record-table__row[data-row-index='0']").first();
    await firstRow.hover();
    await firstRow.getByRole("button", { name: /open member details/i }).click();

    await expect(page.getByRole("heading", { name: "Edit member" })).toBeVisible();
  });

  test("members table shows cell hover actions and floating edit popovers", async ({ page }) => {
    const members = new MembersPage(page);
    await members.gotoDemo();

    const editableCell = page.locator(
      ".record-table__row[data-row-index='0'] .record-table__cell[data-column-index='1']",
    );
    await editableCell.hover();
    await editableCell.getByRole("button", { name: /edit/i }).click();

    await expect(page.locator(".record-table__cell-editor-popover")).toBeVisible();
    await expect(page.locator(".record-table__cell-editor-popover input").first()).toBeVisible();
  });

  test("members table supports type-to-edit from a focused cell", async ({ page }) => {
    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);
    await table.focusCell(0, 1);
    await page.keyboard.press("Z");

    const input = page.locator(".record-table__cell-editor-popover input").first();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("Z");
    await page.keyboard.press("Escape");
  });

  test("members table supports x and Shift+x row selection shortcuts", async ({ page }) => {
    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);
    await table.focusCell(0, 1);
    await page.keyboard.press("x");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+x");

    await expect(page.locator(".record-table__tbody input[type='checkbox']:checked")).toHaveCount(3);
  });

  test("members table exposes per-column header menu actions", async ({ page }) => {
    const members = new MembersPage(page);
    await members.gotoDemo();

    await page.locator(".record-table__header-menu-trigger").first().click();

    await expect(page.getByRole("button", { name: "Sort ascending" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sort descending" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply filter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move right" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide field" })).toBeVisible();
  });
});
