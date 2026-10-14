/**
 * Client-side helpers that turn posted general-ledger lines (from
 * `accounting.generalLedger`) into report rows: trial balances per fiscal
 * year, restricted-fund filtering, and drilldown line lists. Everything is
 * derived from real journal lines; nothing is estimated.
 */

export type LedgerAccount = {
  _id: string;
  code?: string;
  name: string;
  accountType: string;
  currency?: string;
  normalBalance?: string;
};

export type LedgerLine = {
  _id: string;
  journalEntryId: string;
  accountId: string;
  amountCents: number;
  side: "debit" | "credit" | string;
  description?: string;
  lineOrder?: number;
  fundRestrictionId?: string;
  financialTransactionId?: string;
  programCode?: string;
  entry: { _id: string; date: string; memo?: string; entryNumber?: string; status: string; fiscalYear?: string; source?: string };
  account: LedgerAccount | null;
};

export type FundFilter = "all" | "unrestricted" | string;

export const ACCOUNT_SECTIONS: Array<{ id: string; label: string; types: string[] }> = [
  { id: "assets", label: "Assets", types: ["Asset", "Bank"] },
  { id: "liabilities", label: "Liabilities", types: ["Liability", "Credit"] },
  { id: "equity", label: "Equity / net assets", types: ["Equity"] },
  { id: "income", label: "Revenue", types: ["Income"] },
  { id: "expenses", label: "Expenses", types: ["Expense"] },
];

export function sectionForAccountType(accountType: string | undefined) {
  return ACCOUNT_SECTIONS.find((section) => section.types.includes(String(accountType))) ?? null;
}

export function matchesFund(line: Pick<LedgerLine, "fundRestrictionId">, fund: FundFilter) {
  if (fund === "all") return true;
  if (fund === "unrestricted") return !line.fundRestrictionId;
  return String(line.fundRestrictionId ?? "") === fund;
}

/** Fund restrictions that actually carry posted lines, so chips never offer an empty filter. */
export function fundsWithActivity(lines: LedgerLine[], restrictions: Array<{ _id: string; name: string }>) {
  const used = new Set(lines.map((line) => String(line.fundRestrictionId ?? "")).filter(Boolean));
  return restrictions.filter((restriction) => used.has(String(restriction._id)));
}

export function hasUnrestrictedLines(lines: LedgerLine[]) {
  return lines.some((line) => !line.fundRestrictionId);
}

/** Fiscal-year labels present on posted entries, newest first. */
export function ledgerFiscalYears(lines: LedgerLine[]) {
  const years = new Set<string>();
  for (const line of lines) if (line.entry?.fiscalYear) years.add(line.entry.fiscalYear);
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

/** "2026" → "2025"; "2025-2026" → "2024-2025". Returns null for labels we can't step back. */
export function priorFiscalYearLabel(label: string | undefined | null) {
  const text = String(label ?? "").trim();
  const span = /^(\d{4})\s*-\s*(\d{4})$/.exec(text);
  if (span) return `${Number(span[1]) - 1}-${Number(span[2]) - 1}`;
  if (/^\d{4}$/.test(text)) return String(Number(text) - 1);
  return null;
}

export type TrialBalanceRow = {
  account: LedgerAccount;
  debitCents: number;
  creditCents: number;
  /** Debit-positive balance, matching the server trial balance. */
  balanceCents: number;
};

export function trialBalanceFromLines(lines: LedgerLine[]) {
  const totals = new Map<string, TrialBalanceRow>();
  for (const line of lines) {
    if (!line.account || line.entry?.status !== "posted") continue;
    const key = String(line.accountId);
    const row = totals.get(key) ?? { account: line.account, debitCents: 0, creditCents: 0, balanceCents: 0 };
    if (line.side === "debit") row.debitCents += line.amountCents;
    if (line.side === "credit") row.creditCents += line.amountCents;
    row.balanceCents = row.debitCents - row.creditCents;
    totals.set(key, row);
  }
  return totals;
}

/** Natural-balance sign: debit-normal accounts positive when debited, credit-normal when credited. */
export function naturalBalanceCents(account: LedgerAccount, debitPositiveCents: number) {
  const creditNormal = account.normalBalance
    ? account.normalBalance === "credit"
    : ["Liability", "Credit", "Equity", "Income"].includes(account.accountType);
  return creditNormal ? -debitPositiveCents : debitPositiveCents;
}

export function sortByAccountCode(a: LedgerAccount, b: LedgerAccount) {
  return `${a.code ?? ""}:${a.name}`.localeCompare(`${b.code ?? ""}:${b.name}`);
}

export function linesInRange(lines: LedgerLine[], from?: string, to?: string) {
  return lines.filter((line) => (!from || line.entry.date >= from) && (!to || line.entry.date <= to));
}

/** Shift an ISO date by whole years, clamping Feb 29 to Feb 28. */
export function shiftIsoYears(iso: string, years: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const year = Number(match[1]) + years;
  const month = match[2];
  let day = match[3];
  if (month === "02" && day === "29") {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (!leap) day = "28";
  }
  return `${year}-${month}-${day}`;
}
