/**
 * Report identity and filter state for /app/financials/reports/:report. The
 * toolbar keeps its state in the URL (`from`, `to`, `freq`, `basis`, `fund`,
 * `program`, `tag`, `account`, `currency`, `preset`) so a report can be
 * bookmarked or shared and survives switching between reports. `tag` holds
 * comma-separated finance tag ids.
 */
import type { AccountingBasis, BooksReportKind, ReportDimensionFilter, ReportFrequency, ReportLineFilter } from "../../../../shared/booksReports";
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
export const DIMENSION_PARAMS = { programCode: "program", tag: "tag" } as const;
export type DimensionKind = keyof typeof DIMENSION_PARAMS;

/** Kinds whose URL parameter holds several comma-separated values (tag ids never contain commas). */
const MULTI_VALUE_DIMENSIONS: ReadonlySet<DimensionKind> = new Set<DimensionKind>(["tag"]);

/** The URL value for a dimension's values (null clears it). */
export function dimensionParamValue(kind: DimensionKind, values: readonly string[] | null): string | null {
  const kept = (values ?? []).filter(Boolean);
  if (!kept.length) return null;
  return MULTI_VALUE_DIMENSIONS.has(kind) ? [...new Set(kept)].join(",") : kept[0];
}

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
    if (!value) continue;
    const values = MULTI_VALUE_DIMENSIONS.has(kind) ? [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))] : [value];
    if (values.length) dimensions[kind] = values;
  }
  return { fund: params.get("fund") || "all", dimensions };
}

/**
 * The one place the toolbar's filter becomes the server's `filter` argument.
 * Tags become one `{ kind: "tag", values }` dimension per tag group when
 * `groupOf` (tag id → group id) is given: a line matches any chosen tag of a
 * group, and must match every group chosen (Program: Youth mentoring and
 * Grant: Harbour Foundation narrows to lines carrying both). Tags `groupOf`
 * doesn't know share one dimension.
 */
export function toReportFilter(state: ReportFilterState, groupOf?: (tagId: string) => string | undefined): ReportLineFilter | undefined {
  const dimensions = (Object.entries(state.dimensions) as Array<[DimensionKind, string[] | undefined]>)
    .filter((entry): entry is [DimensionKind, string[]] => Boolean(entry[1]?.length))
    .flatMap(([kind, values]): ReportDimensionFilter[] => (kind === "tag" ? tagDimensions(values, groupOf) : [{ kind, values }]));
  const fund = state.fund && state.fund !== "all" ? state.fund : undefined;
  if (!fund && !dimensions.length) return undefined;
  return { ...(fund ? { fund } : {}), ...(dimensions.length ? { dimensions } : {}) };
}

function tagDimensions(tagIds: string[], groupOf?: (tagId: string) => string | undefined) {
  const byGroup = new Map<string, string[]>();
  for (const tagId of tagIds) {
    const group = groupOf?.(tagId) ?? "";
    byGroup.set(group, [...(byGroup.get(group) ?? []), tagId]);
  }
  return [...byGroup.values()].map((values): ReportDimensionFilter => ({ kind: "tag", values }));
}

export function isFiltered(state: ReportFilterState) {
  return Boolean(toReportFilter(state));
}

/** Names for the filter summary: a tag's name and its group's (falls back to "Tag"). */
export type TagNames = { tagName: (tagId: string) => string | undefined; groupName: (tagId: string) => string | undefined };

/** "Fund: Capital campaign · Program: Youth · Grant: Harbour Foundation 2026", or null when unfiltered. */
export function describeFilter(state: ReportFilterState, fundNames: Map<string, string>, tagNames?: TagNames) {
  const parts: string[] = [];
  if (state.fund === "unrestricted") parts.push("Fund: Unrestricted");
  else if (state.fund && state.fund !== "all") parts.push(`Fund: ${fundNames.get(state.fund) ?? "Restricted fund"}`);
  const programs = state.dimensions.programCode ?? [];
  if (programs.length) parts.push(`Program: ${programs.join(", ")}`);
  const byGroup = new Map<string, string[]>();
  for (const tagId of state.dimensions.tag ?? []) {
    const group = tagNames?.groupName(tagId) ?? "Tag";
    byGroup.set(group, [...(byGroup.get(group) ?? []), tagNames?.tagName(tagId) ?? "Removed tag"]);
  }
  for (const [group, names] of byGroup) parts.push(`${group}: ${names.join(", ")}`);
  return parts.length ? parts.join(" · ") : null;
}
