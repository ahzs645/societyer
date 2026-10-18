/**
 * Shared vocabulary for the journal-entries and chart-of-accounts registers:
 * statement-section tabs, humanised source and subtype labels, review flags,
 * and the rule for which journal entries can be edited or voided here.
 */
import type { AccountRef } from "../../../../shared/booksReports";

/** Statement sections, as `accountSection()` in shared/accountHierarchy.ts names them. */
export type BooksSection = "assets" | "liabilities" | "equity" | "income" | "expenses";
export type SectionTab = "all" | BooksSection;

export const SECTION_TABS: ReadonlyArray<{ id: SectionTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "assets", label: "Assets" },
  { id: "liabilities", label: "Liabilities" },
  { id: "equity", label: "Net assets" },
  { id: "income", label: "Revenue" },
  { id: "expenses", label: "Expenses" },
];

export function isBooksSection(value: string): value is BooksSection {
  return value === "assets" || value === "liabilities" || value === "equity" || value === "income" || value === "expenses";
}

/** Rows per tab: every row counts under "all" and under each section it touches. */
export function sectionCounts<T>(rows: readonly T[], sectionsOf: (row: T) => readonly string[]): Record<SectionTab, number> {
  const counts: Record<SectionTab, number> = { all: rows.length, assets: 0, liabilities: 0, equity: 0, income: 0, expenses: 0 };
  for (const row of rows) {
    for (const section of new Set(sectionsOf(row))) if (isBooksSection(section)) counts[section] += 1;
  }
  return counts;
}

/** "accounts_receivable" → "Accounts receivable"; "expenseReport" → "Expense report". */
export function humanise(value: string | null | undefined): string {
  const words = String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  adjustment: "Adjustment",
  opening_balance: "Opening balance",
  transactionCandidate: "Bank transaction",
  financialTransactionBackfill: "Bank backfill",
  expenseReport: "Expense claim",
  invoice: "Invoice",
  invoice_accrual: "Invoice",
  invoice_cash_basis: "Invoice payment",
  bill: "Bill",
  bill_accrual: "Bill",
  bill_cash_basis: "Bill payment",
  import: "Import",
  csv: "Spreadsheet import",
  wave: "Wave",
  ledgersmb: "LedgerSMB",
  payroll: "Payroll",
};

export function sourceLabel(source: string | null | undefined): string {
  const key = String(source ?? "manual");
  return SOURCE_LABEL[key] ?? (humanise(key) || "Manual");
}

export const REVIEW_FLAG_LABEL: Record<string, string> = {
  before_opening_balance: "Before opening balances",
  unmapped_suspense: "Suspense",
};

export const REVIEW_FLAG_HINT: Record<string, string> = {
  before_opening_balance: "Posted although dated on or before the opening-balance entry. Check it isn't already counted in the opening balances.",
  unmapped_suspense: "The other side went to the suspense account because no account was mapped. Move it to the right account.",
};

/** Entries made on this page (manual or closed-period adjustments) are changed here; everything else where it came from. */
export function isEditableSource(source: string | null | undefined): boolean {
  return source === "manual" || source === "adjustment";
}

/**
 * Why an entry can't be edited or voided here, or null when it can. The
 * server enforces the same rules (source and close date).
 */
export function entryLockReason(entry: { source: string; status: string; locked: boolean }, closeDateLabel: string | null | undefined): string | null {
  if (entry.status === "void") return "This entry is void.";
  if (!isEditableSource(entry.source)) return `Posted from ${sourceLabel(entry.source).toLowerCase()}. Change it where it came from.`;
  if (entry.locked) return `The books are closed through ${closeDateLabel ?? "the close date"}. An admin can move the close date in Books settings.`;
  return null;
}

export function accountRefLabel(ref: Pick<AccountRef, "code" | "name">): string {
  return ref.code ? `${ref.code} ${ref.name}` : ref.name;
}
