/**
 * Money moving between the organization's own accounts (paying the card from
 * chequing, topping up a fund) is neither revenue nor expense. Bank feeds
 * record both legs, so statements derived from transactions skip rows whose
 * category marks them as an internal transfer.
 */
export const TRANSFER_CATEGORY = "Transfer";

const TRANSFER_PATTERN = /^(internal\s+)?transfers?(\s+(to|from|between)\b.*)?$/i;

export function isInternalTransfer(txn: object): boolean {
  return TRANSFER_PATTERN.test(String((txn as { category?: unknown }).category ?? "").trim());
}
