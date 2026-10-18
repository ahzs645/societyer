import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A register's records: table rows, or on phones the cards a register that
 * opens records draws instead (`.record-cards__item`). A card keeps the
 * page's row actions (rendered hidden) behind its "Row actions for <record>"
 * button, so the helpers below work on either.
 */
export function recordRows(page: Page) {
  return page.locator(".record-table__row, .record-cards__item");
}

/**
 * A record table row's actions come in two layouts. While the table fits its
 * frame they are inline buttons, with any overflow items behind the row's
 * "Actions for this …" kebab. A table wider than its frame (mouse layouts)
 * folds all of them behind one pinned "Row actions for <record>" button
 * (icon buttons named after their record drop the name there: "Edit Board
 * template" reads "Edit", and a page's own kebab reads "More actions…").
 * Phone cards always use the pinned button. These helpers reach an action
 * in any of these layouts.
 */
export function pinnedRowActions(row: Locator) {
  return row.getByRole("button", { name: /^Row actions for / });
}

/** Whether the row's actions sit behind the pinned "Row actions" button. */
export async function rowActionsArePinned(row: Locator) {
  await expect(row).toBeVisible();
  return pinnedRowActions(row).isVisible();
}

/** Opens the row's action menu (the pinned button, or the inline kebab). */
export async function openRowMenu(row: Locator, kebabName: string) {
  const pinned = pinnedRowActions(row);
  const kebab = row.getByRole("button", { name: kebabName, exact: true });
  await expect(pinned.or(kebab).first()).toBeVisible();
  if (await pinned.isVisible()) await pinned.click();
  else await kebab.click();
}

/**
 * Runs one of the row's inline actions (a button or link named `name`),
 * through the pinned menu, where it may read `menuName`, when the table
 * pins them.
 */
export async function runRowAction(row: Locator, name: string, menuName = name) {
  if (await rowActionsArePinned(row)) {
    await pinnedRowActions(row).click();
    await row.page().getByRole("menuitem", { name: menuName, exact: true }).click();
  } else {
    await row.getByRole("button", { name, exact: true }).or(row.getByRole("link", { name, exact: true })).first().click();
  }
}

/**
 * Opens a page's own row menu (an "Actions for <name>" kebab drawn by the
 * page among its row actions): directly, or as "More actions…" from the
 * pinned menu.
 */
export async function openPageRowMenu(row: Locator, kebabName: string) {
  await runRowAction(row, kebabName, "More actions…");
}
