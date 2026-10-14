import type { Page } from "@playwright/test";

type ViewTypeName = "Table view" | "Kanban view" | "Calendar view" | "List view";

/**
 * Switch a RecordTable's view type. Tablet and desktop show the switch as a
 * row of buttons; phones (<= 560px) fold it into the toolbar's "View type"
 * menu, so open that first when the button isn't on screen.
 */
export async function chooseViewType(page: Page, name: ViewTypeName) {
  await page.locator(".record-table__toolbar").first().waitFor();
  const menuTrigger = page.locator(".record-table__view-type-trigger").first();
  if (await menuTrigger.isVisible()) {
    await menuTrigger.click();
    await page.getByRole("dialog", { name: "View type", exact: true }).getByRole("button", { name, exact: true }).click();
    return;
  }
  await page.getByRole("button", { name, exact: true }).click();
}

/**
 * Phones keep "Select records" (and Search) in the table's Options menu;
 * wider screens show it in the toolbar row. Returns the toggle, menu open.
 */
export async function revealSelectRecords(page: Page) {
  const inRow = page.locator(".record-table__mobile-tools").getByRole("button", { name: "Select records", exact: true });
  if (await inRow.isVisible()) return inRow;
  await page.getByRole("button", { name: "Options", exact: true }).click();
  return page.getByRole("dialog", { name: "Table options", exact: true }).getByRole("button", { name: "Select records", exact: true });
}
