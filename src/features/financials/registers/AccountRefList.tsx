import type { AccountRef } from "../../../../shared/booksReports";
import { accountRefLabel } from "./registerModel";

/**
 * A comma list of ledger accounts for a register cell, cut to the first few
 * with "+N more"; the full list is in the tooltip.
 */
export function AccountRefList({ accounts, max = 2 }: { accounts: readonly AccountRef[]; max?: number }) {
  if (accounts.length === 0) return <span className="muted">—</span>;
  const labels = accounts.map(accountRefLabel);
  const shown = labels.slice(0, max);
  const hidden = labels.length - shown.length;
  return (
    <span className="books-register__accounts" title={labels.join(", ")}>
      <span className="books-register__accounts-list">{shown.join(", ")}</span>
      {hidden > 0 && <span className="books-register__more muted">+{hidden} more</span>}
    </span>
  );
}
