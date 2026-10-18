/*
 * Where the transactions tab's bare-letter keys (R, U, ?) may act. Every
 * drawer renders as `.inspector-panel[role="dialog"]`, so only the
 * transaction panel's own drawer counts as "still on the tab"; the rule
 * editor, payee rename and other dialogs keep their keys. Pure (works on
 * anything with `closest`), so the gate can check it without a DOM.
 */

/** The transaction side panel's drawer (TransactionDetailPanel). */
export const TRANSACTION_PANEL_SELECTOR = ".transaction-panel";

/** Open popups own their keys: menus, listboxes, comboboxes and a trigger whose popup is open. */
export const POPUP_SELECTOR = '[role="menu"], [role="listbox"], [role="combobox"], [aria-haspopup][aria-expanded="true"]';

const DIALOG_SELECTOR = 'dialog, [role="dialog"]';

type ClosestTarget = { closest(selector: string): unknown };

function hasClosest(target: unknown): target is ClosestTarget {
  return typeof target === "object" && target !== null && typeof (target as { closest?: unknown }).closest === "function";
}

/**
 * True when a key event belongs to something other than the transactions
 * tab: an open popup, or a dialog that is not the transaction panel itself
 * (including a dialog opened from inside the panel).
 */
export function keyBelongsElsewhere(target: EventTarget | ClosestTarget | null): boolean {
  if (!hasClosest(target)) return false;
  if (target.closest(POPUP_SELECTOR)) return true;
  const dialog = target.closest(DIALOG_SELECTOR);
  return !!dialog && dialog !== target.closest(TRANSACTION_PANEL_SELECTOR);
}
