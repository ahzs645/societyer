/**
 * DIVIDEND DECLARATION CONTEXT (pure logic).
 *
 * Turns the dividend register rows for a single declaration into the multi-class
 * table the YCN "Doc - Dividends" sheet renders (Class / Amount Per Share /
 * Total Dividends). The packet body (`dividend-declaration`) iterates these via
 * {#each}. Framework-free.
 *
 * The per-share amount is shown exactly as declared (a decimal string such as
 * "0.0125"); older rows without one fall back to their integer cents.
 */

import { formatDecimalAmount, parseDecimalAmount, perShareAmountFromCents } from "./dividends";

export interface DividendDeclarationInput {
  shareClass: string;
  perShareCents: number;
  /** Exact decimal per-share amount; preferred over perShareCents when present. */
  perShareAmount?: string;
  sharesOutstanding?: number;
  totalCents: number;
  /** Symbol-coded currency as stored (e.g. "C$", "US$", "EU€"). */
  currency: string;
  recordDate?: string;
  paymentDate?: string;
  /** Class names deliberately not declared on this occasion. */
  excludedClassNames?: readonly string[];
  /** The directors' solvency confirmation is recorded for this row. */
  solvencyConfirmed?: boolean;
}

export interface DividendDeclarationView {
  className: string;
  perShare: string;
  total: string;
}

export interface DividendResolutionContext {
  hasDeclarations: boolean;
  declarations: DividendDeclarationView[];
  hasDeclaredDate: boolean;
  declaredDate: string;
  hasRecordDate: boolean;
  recordDate: string;
  hasPaymentDate: boolean;
  paymentDate: string;
  hasExcludedClasses: boolean;
  excludedClasses: string;
  /** Every row in the declaration has a recorded solvency confirmation. */
  solvencyConfirmed: boolean;
}

/** Format integer cents with the stored currency symbol, e.g. (50, "C$") → "C$0.50". */
function formatMoney(cents: number, currency: string): string {
  const symbol = String(currency ?? "").trim();
  const amount = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  return symbol ? `${symbol}${amount}` : amount;
}

/** Format an exact decimal per-share amount with the currency symbol, never rounding it. */
function formatRate(row: DividendDeclarationInput): string {
  const symbol = String(row.currency ?? "").trim();
  const parsed = parseDecimalAmount(row.perShareAmount);
  const amount = parsed ? formatDecimalAmount(parsed) : perShareAmountFromCents(row.perShareCents);
  return symbol ? `${symbol}${amount}` : amount;
}

/** The single value shared by every row, or "" when rows disagree or omit it. */
function common(values: Array<string | undefined>): string {
  const distinct = [...new Set(values.map((value) => String(value ?? "").trim()))];
  return distinct.length === 1 ? distinct[0] : "";
}

export function buildDividendResolutionContext(
  rows: readonly DividendDeclarationInput[],
  options?: { declaredDate?: string | null },
): DividendResolutionContext {
  const declarations = rows.map((r) => ({
    className: String(r.shareClass ?? ""),
    perShare: formatRate(r),
    total: formatMoney(r.totalCents, r.currency),
  }));
  const declaredDate = typeof options?.declaredDate === "string" ? options.declaredDate.trim() : "";
  const recordDate = common(rows.map((row) => row.recordDate));
  const paymentDate = common(rows.map((row) => row.paymentDate));
  const declaredNames = new Set(rows.map((row) => String(row.shareClass ?? "").trim()));
  const excluded = [...new Set(rows.flatMap((row) => row.excludedClassNames ?? []).map((name) => String(name).trim()))]
    .filter((name) => name && !declaredNames.has(name));
  return {
    hasDeclarations: declarations.length > 0,
    declarations,
    hasDeclaredDate: declaredDate.length > 0,
    declaredDate,
    hasRecordDate: recordDate.length > 0,
    recordDate,
    hasPaymentDate: paymentDate.length > 0,
    paymentDate,
    hasExcludedClasses: excluded.length > 0,
    excludedClasses: excluded.join(", "),
    solvencyConfirmed: rows.length > 0 && rows.every((row) => row.solvencyConfirmed === true),
  };
}
