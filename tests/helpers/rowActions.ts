import { expect, type Locator } from "@playwright/test";

/**
 * A record table row's actions come in two layouts. While the table fits its
 * frame they are inline buttons, with any overflow items behind the row's
 * "Actions for this …" kebab. A table wider than its frame (mouse layouts)
 * folds all of them behind one pinned "Row actions for <record>" button.
 * These helpers reach an action in either layout.
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

/** Runs one of the row's inline actions, through the pinned menu when the table pins them. */
export async function runRowAction(row: Locator, name: string) {
  if (await rowActionsArePinned(row)) {
    await pinnedRowActions(row).click();
    await row.page().getByRole("menuitem", { name, exact: true }).click();
  } else {
    await row.getByRole("button", { name, exact: true }).click();
  }
}
