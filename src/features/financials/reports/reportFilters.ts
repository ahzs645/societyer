/**
 * Report identity and filter state for /app/financials/reports/:report. The
 * toolbar keeps its state in the URL (`from`, `to`, `freq`, `basis`, `fund`,
 * `program`, `account`, `currency`, `preset`) so a report can be bookmarked or
 * shared and survives switching between reports.
 */
import type { AccountingBasis, BooksReportKind, ReportFrequency, ReportLineFilter } from "../../../../shared/booksReports";
import type { FundFilter } from "../lib/ledgerReports";

export const REPORT_SLUGS = ["balance-sheet", "operations", "cash-flow", "general-ledger"] as const;
export type ReportSlug = (typeof REPORT_SLUGS)[number];
export type StatementSlug = Exclude<ReportSlug, "general-ledger">;

export const REPORT_TITLES: Record<ReportSlug, string> = {
  "balance-sheet": "Balance sheet",
  operations: "Statement of operations",
  "cash-flow": "Cash flow",
  "general-ledger": "General ledger",
};

export const STATEMENT_KINDS: Record<StatementSlug, BooksReportKind> = {
  "balance-sheet": "balance_sheet",
  operations: "operations",
  "cash-flow": "cash_flow",
};

export function isReportSlug(value: unknown): value is ReportSlug {
  return typeof value === "string" && (REPORT_SLUGS as readonly string[]).includes(value);
}

export const FREQUENCY_LABELS: Record<ReportFrequency, string> = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };

export function isFrequency(value: unknown): value is ReportFrequency {
  return value === "month" || value === "quarter" || value === "year";
}

export function isBasis(value: unknown): value is AccountingBasis {
  return value === "accrual" || value === "cash";
}

export const BASIS_LABELS: Record<AccountingBasis, string> = { accrual: "Accrual", cash: "Cash" };

/** Dimension kinds the toolbar filters on, keyed by the URL parameter that holds each. */
export const DIMENSION_PARAMS = { programCode: "program" } as const;
export type DimensionKind = keyof typeof DIMENSION_PARAMS;

/**
 * What the report lines are filtered to: a fund plus any dimensions. The same
 * shape the server takes (`ReportLineFilter`), keyed by kind for easy editing.
 */
export type ReportFilterState = {
  fund: FundFilter;
  dimensions: Partial<Record<DimensionKind, string[]>>;
};

export function readFilterState(params: URLSearchParams): ReportFilterState {
  const dimensions: ReportFilterState["dimensions"] = {};
  for (const [kind, param] of Object.entries(DIMENSION_PARAMS) as Array<[DimensionKind, string]>) {
    const value = params.get(param);
    if (value) dimensions[kind] = [value];
  }
  return { fund: params.get("fund") || "all", dimensions };
}

/**
 * The one place the toolbar's filter becomes the server's `filter` argument.
 * Tag dimensions plug in here: add `tag: "tag"` to DIMENSION_PARAMS (and a
 * toolbar control) and they flow through as `{ kind: "tag", values }`.
 */
export function toReportFilter(state: ReportFilterState): ReportLineFilter | undefined {
  const dimensions = (Object.entries(state.dimensions) as Array<[DimensionKind, string[] | undefined]>)
    .filter((entry): entry is [DimensionKind, string[]] => Boolean(entry[1]?.length))
    .map(([kind, values]) => ({ kind, values }));
  const fund = state.fund && state.fund !== "all" ? state.fund : undefined;
  if (!fund && !dimensions.length) return undefined;
  return { ...(fund ? { fund } : {}), ...(dimensions.length ? { dimensions } : {}) };
}

export function isFiltered(state: ReportFilterState) {
  return Boolean(toReportFilter(state));
}

/** "Fund: Capital campaign · Program: Youth", or null when unfiltered. */
export function describeFilter(state: ReportFilterState, fundNames: Map<string, string>) {
  const parts: string[] = [];
  if (state.fund === "unrestricted") parts.push("Fund: Unrestricted");
  else if (state.fund && state.fund !== "all") parts.push(`Fund: ${fundNames.get(state.fund) ?? "Restricted fund"}`);
  const programs = state.dimensions.programCode ?? [];
  if (programs.length) parts.push(`Program: ${programs.join(", ")}`);
  return parts.length ? parts.join(" · ") : null;
}
