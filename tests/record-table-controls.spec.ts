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
    await table.focusFirstCell();
    await page.keyboard.press("ArrowRight");
    await table.expectFocusedCell(0, 1);
    await page.keyboard.press("ArrowDown");
    await table.expectFocusedCell(1, 1);
    await table.enterEditMode();
    await page.keyboard.press("Escape");
    await table.expectNoFocusedCell();
  });
});
