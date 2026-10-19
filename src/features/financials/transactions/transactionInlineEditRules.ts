/**
 * Pure rules for editing transactions in the Financials table (grid mode):
 * which rows are locked and the chart-account choices for the category
 * column. Used by useTransactionInlineEdit and the transactions-surface gate.
 */
import type { GridOption } from "../../../components/EditableGrid/types";
import type { InlineEditRecord } from "../../../platform/record-engine/record-table/contexts/RecordTableInlineEditContext";
import { isSplitTransaction, type LineTransaction } from "../../../../shared/transactionLines";

/** Bank and card accounts hold the money; a category is the other side of the entry. */
const BANK_TYPES = new Set(["Bank", "Credit"]);

export type InlineEditAccount = { _id: string; name: string; code?: string; accountType?: string };
export type InlineEditFund = { _id: string; name: string; purpose?: string };

export type TransactionRow = InlineEditRecord & LineTransaction & { _id: string; date?: string; reconciledAtISO?: string };

/**
 * Why a transaction row can't be edited in the table, or null when it can:
 * a split (its lines are edited in the panel), a reconciled line, or a line
 * dated on or before the books close date.
 */
export function transactionRowLock(record: Pick<TransactionRow, "lines" | "reconciledAtISO" | "date">, closeDate: string | null | undefined): string | null {
  if (isSplitTransaction(record)) return "Split into lines: edit them in the transaction panel.";
  if (record.reconciledAtISO) return "Reconciled: unmatch it before editing.";
  if (closeDate && record.date && String(record.date) <= closeDate) return `The books are closed through ${closeDate}.`;
  return null;
}

/** Chart accounts as category choices: "5200 Facilities and utilities", its type as the hint. */
export function categoryAccountOptions(accounts: readonly InlineEditAccount[]): GridOption[] {
  return accounts
    .filter((account) => !BANK_TYPES.has(String(account.accountType ?? "")))
    .map((account) => ({
      value: account._id,
      label: `${account.code ? `${account.code} ` : ""}${account.name}`,
      hint: account.accountType,
      keywords: [account.name, ...(account.code ? [account.code] : [])],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
