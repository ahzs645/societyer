import type { Locator, Page } from "@playwright/test";

type ViewTypeName = "Table view" | "Kanban view" | "Calendar view" | "List view";

/**
 * Phones (<= 560px) keep one toolbar row: the saved-view picker, Filter and
 * "View options". The View options bottom sheet holds search, "Select
 * records", export, layout (view type), sort, group, density and fields.
 * Returns the sheet once open, or null off phones (no such button).
 */
export async function openPhoneViewOptions(page: Page): Promise<Locator | null> {
  await page.locator(".record-table__toolbar").first().waitFor();
  // Named "View options" (plus "· N active" while sorted or grouped); wider
  // screens' "Options" button opens the desktop "Table options" popover.
  const trigger = page.locator(".record-table__toolbar").first().getByRole("button", { name: /^View options/ });
  if (!(await trigger.isVisible())) return null;
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "View options", exact: true });
  await sheet.waitFor();
  return sheet;
}

/** Close the phone View options sheet from its header. */
export async function closePhoneViewOptions(page: Page) {
  const sheet = page.getByRole("dialog", { name: "View options", exact: true });
  if (!(await sheet.isVisible())) return;
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await sheet.waitFor({ state: "hidden" });
}

/**
 * Switch a RecordTable's view type. Tablet and desktop show the switch as a
 * row of buttons; phones choose it under "Layout" in the View options sheet,
 * which is closed again afterwards so the new view is reachable.
 */
export async function chooseViewType(page: Page, name: ViewTypeName) {
  const sheet = await openPhoneViewOptions(page);
  if (sheet) {
    await sheet.getByRole("radio", { name, exact: true }).click();
    await closePhoneViewOptions(page);
    return;
  }
  await page.getByRole("button", { name, exact: true }).click();
}

/**
 * "Select records": tablets show it as an icon in the toolbar row; phones
 * keep it in the View options sheet (which closes when it is pressed).
 * Returns the toggle, ready to press.
 */
export async function revealSelectRecords(page: Page) {
  const inRow = page.locator(".record-table__mobile-tools").getByRole("button", { name: "Select records", exact: true });
  if (await inRow.isVisible()) return inRow;
  const sheet = await openPhoneViewOptions(page);
  if (!sheet) throw new Error("Select records is offered on touch layouts only (tablet toolbar row or phone View options).");
  return sheet.getByRole("button", { name: "Select records", exact: true });
}
