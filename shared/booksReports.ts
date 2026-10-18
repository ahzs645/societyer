/**
 * Multi-period books reports: the balance sheet, the statement of operations
 * and cash flow, one column per month, quarter or fiscal year, plus the general
 * ledger, the journal-entry register and the chart-of-accounts register. All
 * figures come from posted journal lines; nothing is estimated.
 *
 * Shared by the portable queries (shared/functions/accounting.ts), so hosted
 * Convex, the in-browser demo and the gate script (scripts/check-books-reports.ts)
 * compute the same numbers. Pure TypeScript: no Convex, DOM or Node imports.
 *
 * Conventions other features rely on (see docs/accounting-shape.md):
 *  - Accounting basis. A journal entry's `basis` is "both" (the default),
 *    "accrual-only" (an invoice or bill accrual: Dr receivable / Cr revenue,
 *    Dr expense / Cr payable) or "cash-only" (the recognition posted when that
 *    invoice or bill is paid: Dr receivable / Cr revenue again, or Dr expense /
 *    Cr payable). Cash-basis reports drop accrual-only entries and accrual-basis
 *    reports drop cash-only ones, so revenue and expenses land on the payment
 *    date under cash basis and the receivable / payable nets to zero. Entries
 *    without `basis` fall back to their `source` (ACCRUAL_ONLY_SOURCES,
 *    CASH_ONLY_SOURCES), else "both".
 *  - Dimension filter. Reports take `filter.dimensions`, a list of
 *    `{ kind, values }`; a line passes when it matches every listed dimension.
 *    DIMENSION_MATCHERS holds the supported kinds ("programCode",
 *    "counterparty", "tag"); "tag" reads `journalLines.tagIds` once lines carry
 *    tag ids.
 */
import { accountSection, compareAccounts } from "./accountHierarchy";

export type ReportFrequency = "month" | "quarter" | "year";
export type AccountingBasis = "accrual" | "cash";
export type BooksReportKind = "balance_sheet" | "operations" | "cash_flow";

export const REPORT_FREQUENCIES: readonly ReportFrequency[] = ["month", "quarter", "year"];
export const ACCOUNTING_BASES: readonly AccountingBasis[] = ["accrual", "cash"];
export const BOOKS_REPORT_KINDS: readonly BooksReportKind[] = ["balance_sheet", "operations", "cash_flow"];

/* ------------------------------------------------------------------ basis */

export const JOURNAL_BASES = ["both", "accrual-only", "cash-only"] as const;
export type JournalBasis = (typeof JOURNAL_BASES)[number];

/** Entry sources that are accrual-only when the entry carries no explicit `basis`. */
export const ACCRUAL_ONLY_SOURCES: readonly string[] = ["invoice", "bill", "invoice_accrual", "bill_accrual"];
/** Entry sources that are cash-only (recognition on payment) when the entry carries no explicit `basis`. */
export const CASH_ONLY_SOURCES: readonly string[] = ["invoice_cash_basis", "bill_cash_basis"];

export function isJournalBasis(value: unknown): value is JournalBasis {
  return typeof value === "string" && (JOURNAL_BASES as readonly string[]).includes(value);
}

export function journalBasisOf(entry: { basis?: string | null; source?: string | null }): JournalBasis {
  if (isJournalBasis(entry.basis)) return entry.basis;
  const source = String(entry.source ?? "");
  if (ACCRUAL_ONLY_SOURCES.includes(source)) return "accrual-only";
  if (CASH_ONLY_SOURCES.includes(source)) return "cash-only";
  return "both";
}

/** Whether an entry belongs in a report prepared on `basis`. */
export function entryCountsForBasis(entry: { basis?: string | null; source?: string | null }, basis: AccountingBasis) {
  const kind = journalBasisOf(entry);
  if (kind === "both") return true;
  return basis === "cash" ? kind === "cash-only" : kind === "accrual-only";
}

/* -------------------------------------------------------------- the inputs */

export type BooksAccount = {
  _id: string;
  code?: string | null;
  name: string;
  accountType: string;
  subtype?: string | null;
  currency?: string | null;
  normalBalance?: string | null;
  parentAccountId?: string | null;
  /** Optional override: "operating" | "investing" | "financing". */
  cashFlowClass?: string | null;
};

export type BooksEntry = {
  _id: string;
  date: string;
  status: string;
  source?: string | null;
  basis?: string | null;
  memo?: string | null;
  entryNumber?: string | null;
  reference?: string | null;
  createdAtISO?: string | null;
  reviewFlags?: string[] | null;
};

export type BooksLine = {
  _id: string;
  journalEntryId: string;
  accountId: string;
  amountCents: number;
  side: string;
  lineOrder?: number | null;
  description?: string | null;
  programCode?: string | null;
  counterpartyId?: string | null;
  fundRestrictionId?: string | null;
  financialTransactionId?: string | null;
  /** Tag ids, once journal lines carry them. */
  tagIds?: string[] | null;
};

/* ------------------------------------------------------------- the filter */

/** "all" · "unrestricted" (no fund) · a fund restriction id. */
export type FundFilterValue = string;
export type ReportDimensionFilter = { kind: string; values: string[] };
export type ReportLineFilter = { fund?: FundFilterValue | null; dimensions?: ReportDimensionFilter[] | null };

export const UNALLOCATED_PROGRAM = "Unallocated";

/**
 * Supported dimension kinds. Add a kind here and every report, drilldown and
 * ledger query accepts it.
 */
export const DIMENSION_MATCHERS: Record<string, (line: BooksLine, values: string[]) => boolean> = {
  programCode: (line, values) => values.includes(String(line.programCode ?? "").trim() || UNALLOCATED_PROGRAM),
  counterparty: (line, values) => Boolean(line.counterpartyId) && values.includes(String(line.counterpartyId)),
  tag: (line, values) => (line.tagIds ?? []).some((id) => values.includes(String(id))),
};

export function validateLineFilter(filter: ReportLineFilter | null | undefined) {
  for (const dimension of filter?.dimensions ?? []) {
    if (!DIMENSION_MATCHERS[dimension.kind]) {
      throw new Error(`Unsupported report filter "${dimension.kind}". Use one of: ${Object.keys(DIMENSION_MATCHERS).join(", ")}.`);
    }
  }
}

export function lineMatchesFilter(line: BooksLine, filter: ReportLineFilter | null | undefined) {
  const fund = filter?.fund;
  if (fund && fund !== "all") {
    if (fund === "unrestricted" ? Boolean(line.fundRestrictionId) : String(line.fundRestrictionId ?? "") !== fund) return false;
  }
  for (const dimension of filter?.dimensions ?? []) {
    if (!dimension.values.length) continue;
    const matcher = DIMENSION_MATCHERS[dimension.kind];
    if (!matcher || !matcher(line, dimension.values)) return false;
  }
  return true;
}

export function isFilterActive(filter: ReportLineFilter | null | undefined) {
  return Boolean((filter?.fund && filter.fund !== "all") || (filter?.dimensions ?? []).some((dimension) => dimension.values.length > 0));
}

/* ------------------------------------------------------------------ dates */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function ymd(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addIsoDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** First and last day of the month `offset` months after (year, month). */
function monthAt(year: number, month: number, offset: number) {
  const index = year * 12 + (month - 1) + offset;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { year: y, month: m, start: ymd(y, m, 1), end: ymd(y, m, daysInMonth(y, m)) };
}

/** Month (1-12) the fiscal year starts in, from a "MM-DD" year end; January when unknown. */
export function fiscalYearStartMonth(fiscalYearEnd: string | null | undefined) {
  const match = /^(\d{2})-(\d{2})$/.exec(String(fiscalYearEnd ?? "").trim());
  if (!match) return 1;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return 1;
  // A year end on the last day of a month starts the next month; a mid-month
  // year end is rounded to the month it falls in.
  const day = Number(match[2]);
  const endsAtMonthEnd = day >= daysInMonth(2025, month) || (month === 2 && day >= 28);
  return endsAtMonthEnd ? (month % 12) + 1 : month;
}

/** Fiscal year containing `iso`, as its start date, plus a label ("2026" or "FY2025-26"). */
export function fiscalYearOf(iso: string, startMonth: number) {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  const start = ymd(startYear, startMonth, 1);
  const end = addIsoDays(monthAt(startYear, startMonth, 12).start, -1);
  const label = startMonth === 1 ? String(startYear) : `FY${startYear}-${String(startYear + 1).slice(2)}`;
  return { start, end, label };
}

type Bucket = { start: string; end: string; label: string; toDateLabel: string; kind: "MTD" | "QTD" | "YTD" };

function bucketFor(iso: string, frequency: ReportFrequency, startMonth: number): Bucket {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (frequency === "month") {
    const m = monthAt(year, month, 0);
    return { start: m.start, end: m.end, label: `${MONTHS[month - 1]} ${year}`, toDateLabel: `${MONTHS[month - 1]} MTD`, kind: "MTD" };
  }
  const fiscal = fiscalYearOf(iso, startMonth);
  if (frequency === "year") {
    return { start: fiscal.start, end: fiscal.end, label: fiscal.label, toDateLabel: `${fiscal.label} YTD`, kind: "YTD" };
  }
  const offset = (month - startMonth + 12) % 12;
  const quarter = Math.floor(offset / 3);
  const first = monthAt(Number(fiscal.start.slice(0, 4)), startMonth, quarter * 3);
  const last = monthAt(first.year, first.month, 2);
  const label = `Q${quarter + 1} ${fiscal.label}`;
  return { start: first.start, end: last.end, label, toDateLabel: `Q${quarter + 1} QTD`, kind: "QTD" };
}

export type ReportPeriod = {
  id: string;
  label: string;
  /** Exact dates, for headers' titles and drilldown subtitles. */
  start: string;
  end: string;
  /** "MTD" / "QTD" / "YTD" for the current, still-running period. */
  toDate: "MTD" | "QTD" | "YTD" | null;
  /** True when the range cuts the period short at either end (other than the running period). */
  clipped: boolean;
};

/** Hard cap on columns, so a daily-sized range can't build a thousand-column report. */
export const MAX_REPORT_PERIODS = 60;

/**
 * Columns for a report from `from` to `to`. Ranges never run past `today`: the
 * period containing today ends today and is labelled MTD, QTD or YTD. Quarters
 * and years follow the fiscal year (`fiscalStartMonth`).
 */
export function buildReportPeriods({
  from,
  to,
  frequency,
  today,
  fiscalStartMonth = 1,
}: {
  from: string;
  to: string;
  frequency: ReportFrequency;
  today: string;
  fiscalStartMonth?: number;
}): ReportPeriod[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error("Choose a valid report date range.");
  if (!REPORT_FREQUENCIES.includes(frequency)) throw new Error("Choose monthly, quarterly or yearly columns.");
  const end = from <= today && to > today ? today : to;
  const periods: ReportPeriod[] = [];
  let cursor = from;
  while (cursor <= end) {
    const bucket = bucketFor(cursor, frequency, fiscalStartMonth);
    const periodEnd = bucket.end < end ? bucket.end : end;
    const cutShort = periodEnd < bucket.end;
    const running = cutShort && periodEnd === today;
    periods.push({
      id: `p${periods.length}:${cursor}`,
      label: running ? bucket.toDateLabel : bucket.label,
      start: cursor,
      end: periodEnd,
      toDate: running ? bucket.kind : null,
      clipped: cursor > bucket.start || (cutShort && !running),
    });
    if (periods.length > MAX_REPORT_PERIODS) throw new Error(`That range has more than ${MAX_REPORT_PERIODS} columns. Choose a shorter range or quarterly or yearly columns.`);
    cursor = addIsoDays(bucket.end, 1);
  }
  return periods;
}

/** Which period a date falls in (-1 before the first, `periods.length` after the last). */
function periodIndex(periods: ReportPeriod[], date: string) {
  if (!periods.length || date < periods[0].start) return -1;
  for (let index = 0; index < periods.length; index += 1) if (date <= periods[index].end) return index;
  return periods.length;
}

/* ---------------------------------------------------------- the ledger set */

const SUPPORTED_TYPES = new Set(["Asset", "Bank", "Credit", "Liability", "Equity", "Income", "Expense"]);
const CREDIT_NORMAL_TYPES = new Set(["Liability", "Credit", "Equity", "Income"]);

export function isCreditNormal(account: Pick<BooksAccount, "accountType" | "normalBalance">) {
  if (account.normalBalance === "credit") return true;
  if (account.normalBalance === "debit") return false;
  return CREDIT_NORMAL_TYPES.has(account.accountType);
}

/** Cash and bank accounts: what the cash-flow report counts as cash. */
export function isCashAccount(account: Pick<BooksAccount, "accountType" | "subtype">) {
  if (account.accountType === "Bank") return true;
  return account.accountType === "Asset" && /cash/i.test(String(account.subtype ?? ""));
}

type Posted = { line: BooksLine; entry: BooksEntry; account: BooksAccount; signed: number };

export type LedgerSetInput = {
  accounts: BooksAccount[];
  entries: BooksEntry[];
  lines: BooksLine[];
  basis: AccountingBasis;
  currency?: string | null;
  filter?: ReportLineFilter | null;
};

/** The currency most accounts with posted lines use (CAD when nothing is posted). */
export function defaultReportCurrency(accounts: BooksAccount[], lines: BooksLine[]) {
  const byId = new Map(accounts.map((account) => [String(account._id), account]));
  const counts = new Map<string, number>();
  for (const line of lines) {
    const currency = byId.get(String(line.accountId))?.currency;
    if (currency) counts.set(currency, (counts.get(currency) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? accounts.find((account) => account.currency)?.currency ?? "CAD";
}

export function reportCurrencies(accounts: BooksAccount[]) {
  return [...new Set(accounts.map((account) => account.currency).filter((value): value is string => Boolean(value)))].sort();
}

/**
 * Posted, valid lines on the chosen basis and currency. `filtered` also passes
 * the fund / dimension filter; `all` keeps every line of those entries (the
 * cash-flow report needs the cash side of an entry whatever its tags).
 */
function ledgerSet(input: LedgerSetInput) {
  validateLineFilter(input.filter);
  const warnings = new Set<string>();
  const accountById = new Map(input.accounts.map((account) => [String(account._id), account]));
  const entryById = new Map<string, BooksEntry>();
  for (const entry of input.entries) {
    if (entry.status !== "posted" || !entryCountsForBasis(entry, input.basis)) continue;
    if (!isIsoDate(entry.date)) {
      warnings.add("A posted entry has an invalid date and was left out.");
      continue;
    }
    entryById.set(String(entry._id), entry);
  }
  const currency = input.currency ?? defaultReportCurrency(input.accounts, input.lines);
  const all: Posted[] = [];
  const otherCurrencies = new Set<string>();
  for (const line of input.lines) {
    const entry = entryById.get(String(line.journalEntryId));
    if (!entry) continue;
    const account = accountById.get(String(line.accountId));
    if (!account || !SUPPORTED_TYPES.has(account.accountType)) {
      warnings.add("Some posted lines have no supported account type and were left out.");
      continue;
    }
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents < 0 || (line.side !== "debit" && line.side !== "credit")) {
      warnings.add("Some posted lines have invalid amounts or sides and were left out.");
      continue;
    }
    if ((account.currency ?? currency) !== currency) {
      otherCurrencies.add(String(account.currency));
      continue;
    }
    all.push({ line, entry, account, signed: line.side === "debit" ? line.amountCents : -line.amountCents });
  }
  if (otherCurrencies.size) warnings.add(`Lines in ${[...otherCurrencies].sort().join(", ")} are reported separately; choose that currency to see them.`);
  const filtered = isFilterActive(input.filter) ? all.filter((row) => lineMatchesFilter(row.line, input.filter)) : all;
  return { all, filtered, currency, accountById, warnings, dimensionValues: dimensionValues(all) };
}

/** Values the dimension filter can offer, from the posted lines on this basis and currency. */
export type DimensionValues = { programCode: string[] };

function dimensionValues(rows: Posted[]): DimensionValues {
  const programs = new Set<string>();
  for (const row of rows) {
    const section = accountSection(row.account.accountType);
    if (section === "income" || section === "expenses") programs.add(String(row.line.programCode ?? "").trim() || UNALLOCATED_PROGRAM);
  }
  return { programCode: [...programs].sort((a, b) => (a === UNALLOCATED_PROGRAM ? 1 : b === UNALLOCATED_PROGRAM ? -1 : a.localeCompare(b))) };
}

/* -------------------------------------------------------- the report rows */

export type ReportValues = Record<string, number>;

export type BooksReportRow = {
  id: string;
  kind: "section" | "row" | "subtotal" | "total" | "note";
  label: string;
  title?: string;
  code?: string;
  values?: ReportValues;
  children?: BooksReportRow[];
  note?: string;
  calculated?: boolean;
  favourable?: "increase" | "decrease";
  drilldown?: boolean;
  /** What a click on an amount opens: the account(s) and how the figure is built. */
  drill?: { accountIds: string[]; scope: "balance" | "period" | "cash" };
};

export type BooksReportSummaryPoint = { periodId: string; label: string; end: string; values: ReportValues };

export type BooksReport = {
  kind: BooksReportKind;
  basis: AccountingBasis;
  currency: string;
  currencies: string[];
  periods: ReportPeriod[];
  /** Column id of the Total column, when the report has one. */
  totalColumn: string | null;
  rows: BooksReportRow[];
  summary: BooksReportSummaryPoint[];
  warnings: string[];
  filtered: boolean;
  postedLineCount: number;
  dimensionValues: DimensionValues;
};

export const TOTAL_COLUMN = "total";

type Vector = number[];
const zeros = (size: number): Vector => Array.from({ length: size }, () => 0);
const plus = (a: Vector, b: Vector) => a.map((value, index) => value + (b[index] ?? 0));
const minus = (a: Vector, b: Vector) => a.map((value, index) => value - (b[index] ?? 0));
const scaled = (a: Vector, factor: number) => a.map((value) => value * factor);
const isZero = (a: Vector) => a.every((value) => value === 0);

function toValues(periods: ReportPeriod[], vector: Vector, total?: number): ReportValues {
  const values: ReportValues = {};
  // `|| 0` turns -0 into 0 so an empty cell never renders as "-$0.00".
  periods.forEach((period, index) => { values[period.id] = (vector[index] ?? 0) || 0; });
  if (total !== undefined) values[TOTAL_COLUMN] = total || 0;
  return values;
}

type TreeNode = { account: BooksAccount; own: Vector | null; total: Vector; accountIds: string[]; children: TreeNode[] };

/**
 * Nest accounts by the chart's parent hierarchy, climbing only while the
 * parent stays in the same group (statement section / cash-flow activity)
 * and currency, so a malformed parent can never move amounts between
 * sections. A parent shows up when any sub-account has activity.
 */
function accountTree(own: Map<string, Vector>, accountById: Map<string, BooksAccount>, size: number, sameGroup: (child: BooksAccount, parent: BooksAccount) => boolean): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const parentOf = new Map<string, string | null>();
  const ensure = (account: BooksAccount) => {
    const id = String(account._id);
    let node = nodes.get(id);
    if (!node) {
      node = { account, own: null, total: zeros(size), accountIds: [id], children: [] };
      nodes.set(id, node);
    }
    return node;
  };
  for (const [accountId, vector] of own) {
    const account = accountById.get(accountId);
    if (!account) continue;
    ensure(account).own = vector;
    let childId = accountId;
    let current = account;
    const seen = new Set([accountId]);
    while (current.parentAccountId) {
      const parentId = String(current.parentAccountId);
      const parent = accountById.get(parentId);
      if (!parent || seen.has(parentId) || !sameGroup(account, parent) || (parent.currency ?? "") !== (account.currency ?? "")) break;
      seen.add(parentId);
      if (!parentOf.has(childId)) parentOf.set(childId, parentId);
      ensure(parent);
      childId = parentId;
      current = parent;
    }
    if (!parentOf.has(childId)) parentOf.set(childId, null);
  }
  const roots: TreeNode[] = [];
  for (const [id, node] of nodes) {
    const parent = parentOf.get(id) ? nodes.get(parentOf.get(id) as string) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (a: TreeNode, b: TreeNode) => compareAccounts(
    { _id: a.account._id, code: a.account.code, name: a.account.name, accountType: "" },
    { _id: b.account._id, code: b.account.code, name: b.account.name, accountType: "" },
  );
  const finish = (node: TreeNode): TreeNode => {
    node.children.sort(order).forEach(finish);
    node.total = node.own ? [...node.own] : zeros(size);
    for (const child of node.children) {
      node.total = plus(node.total, child.total);
      node.accountIds.push(...child.accountIds);
    }
    return node;
  };
  return roots.sort(order).map(finish);
}

function treeRows(
  prefix: string,
  nodes: TreeNode[],
  periods: ReportPeriod[],
  options: { scope: "balance" | "period" | "cash"; favourable?: "increase" | "decrease"; withTotal: boolean; totalOf?: (vector: Vector) => number },
): BooksReportRow[] {
  const totalOf = options.totalOf ?? ((vector: Vector) => vector.reduce((sum, value) => sum + value, 0));
  const values = (vector: Vector) => toValues(periods, vector, options.withTotal ? totalOf(vector) : undefined);
  const toRow = (node: TreeNode): BooksReportRow => {
    const id = String(node.account._id);
    const row: BooksReportRow = {
      id: `${prefix}:${id}`,
      kind: "row",
      code: node.account.code || undefined,
      label: node.account.name,
      favourable: options.favourable,
      values: values(node.total),
      drill: { accountIds: node.accountIds, scope: options.scope },
    };
    if (!node.children.length) return row;
    const own: BooksReportRow[] = node.own && !isZero(node.own)
      ? [{ id: `${prefix}:${id}:own`, kind: "row", label: `${node.account.name}, other`, title: `${node.account.name}, posted to the parent account`, favourable: options.favourable, values: values(node.own), drill: { accountIds: [id], scope: options.scope } }]
      : [];
    return {
      ...row,
      title: `${node.account.name}, including sub-accounts`,
      children: [
        ...own,
        ...node.children.map(toRow),
      ],
    };
  };
  return nodes.map(toRow);
}

function sectionBlock(
  id: string,
  label: string,
  nodes: TreeNode[],
  total: Vector,
  periods: ReportPeriod[],
  options: { scope: "balance" | "period" | "cash"; favourable?: "increase" | "decrease"; withTotal: boolean; totalOf?: (vector: Vector) => number; totalLabel?: string; emptyLabel?: string },
): BooksReportRow[] {
  const totalOf = options.totalOf ?? ((vector: Vector) => vector.reduce((sum, value) => sum + value, 0));
  const children = treeRows(id, nodes, periods, options);
  return [
    {
      id: `section:${id}`,
      kind: "section",
      label,
      children: children.length ? children : [{ id: `${id}:none`, kind: "note", label: options.emptyLabel ?? `No ${label.toLowerCase()} with posted lines` }],
    },
    {
      id: `subtotal:${id}`,
      kind: "subtotal",
      label: options.totalLabel ?? `Total ${label.toLowerCase()}`,
      favourable: options.favourable,
      values: toValues(periods, total, options.withTotal ? totalOf(total) : undefined),
      drilldown: false,
    },
  ];
}

/** Current vs capital assets, current vs long-term liabilities (by subtype). */
const CAPITAL_ASSET_SUBTYPE = /fixed|capital|equipment|property|vehicle|building|furniture|investment_long|long_term/i;
const LONG_TERM_LIABILITY_SUBTYPE = /loan|mortgage|long_term|long-term|note_payable/i;

export function balanceSheetGroup(account: BooksAccount): "current_assets" | "capital_assets" | "current_liabilities" | "long_term_liabilities" | "net_assets" | null {
  switch (accountSection(account.accountType)) {
    case "assets": return CAPITAL_ASSET_SUBTYPE.test(String(account.subtype ?? "")) ? "capital_assets" : "current_assets";
    case "liabilities": return LONG_TERM_LIABILITY_SUBTYPE.test(String(account.subtype ?? "")) ? "long_term_liabilities" : "current_liabilities";
    case "equity": return "net_assets";
    default: return null;
  }
}

export type CashFlowActivity = "operating" | "investing" | "financing";

export function cashFlowActivity(account: BooksAccount): CashFlowActivity {
  const override = String(account.cashFlowClass ?? "").toLowerCase();
  if (override === "operating" || override === "investing" || override === "financing") return override;
  const group = balanceSheetGroup(account);
  if (group === "capital_assets") return "investing";
  if (group === "long_term_liabilities" || group === "net_assets") return "financing";
  return "operating";
}

type ReportInput = LedgerSetInput & { periods: ReportPeriod[] };

function basicReport(kind: BooksReportKind, input: ReportInput, set: ReturnType<typeof ledgerSet>, extra: Pick<BooksReport, "rows" | "summary" | "totalColumn">, warnings: string[] = []): BooksReport {
  return {
    kind,
    basis: input.basis,
    currency: set.currency,
    currencies: reportCurrencies(input.accounts),
    periods: input.periods,
    ...extra,
    warnings: [...set.warnings, ...warnings],
    filtered: isFilterActive(input.filter),
    postedLineCount: set.filtered.length,
    dimensionValues: set.dimensionValues,
  };
}

/** Per-account movement in each period, and the balance before the first period. */
function movements(rows: Posted[], periods: ReportPeriod[]) {
  const size = periods.length;
  const moved = new Map<string, Vector>();
  const opening = new Map<string, number>();
  for (const row of rows) {
    const index = periodIndex(periods, row.entry.date);
    if (index >= size) continue;
    const id = String(row.account._id);
    if (index < 0) {
      opening.set(id, (opening.get(id) ?? 0) + row.signed);
      continue;
    }
    const vector = moved.get(id) ?? zeros(size);
    vector[index] += row.signed;
    moved.set(id, vector);
  }
  return { moved, opening };
}

/**
 * Balance sheet as at the end of each period: assets, liabilities and net
 * assets (natural signs), with revenue less expenses not yet closed to net
 * assets shown as a calculated line so the statement balances before the
 * year-end closing entries are posted.
 */
export function buildBalanceSheet(input: ReportInput): BooksReport {
  const set = ledgerSet(input);
  const { periods } = input;
  const size = periods.length;
  const { moved, opening } = movements(set.filtered, periods);
  const closing = new Map<string, Vector>();
  const ids = new Set([...moved.keys(), ...opening.keys()]);
  for (const id of ids) {
    let running = opening.get(id) ?? 0;
    const vector = moved.get(id) ?? zeros(size);
    closing.set(id, vector.map((value) => (running += value)));
  }
  const groups = { current_assets: new Map<string, Vector>(), capital_assets: new Map<string, Vector>(), current_liabilities: new Map<string, Vector>(), long_term_liabilities: new Map<string, Vector>(), net_assets: new Map<string, Vector>() };
  let unclosed = zeros(size);
  for (const [id, vector] of closing) {
    const account = set.accountById.get(id);
    if (!account) continue;
    const group = balanceSheetGroup(account);
    if (group) {
      if (isZero(vector)) continue;
      groups[group].set(id, group === "current_assets" || group === "capital_assets" ? vector : scaled(vector, -1));
    } else {
      // Revenue and expenses through each period end, not yet closed to net assets.
      unclosed = minus(unclosed, vector);
    }
  }
  const sum = (map: Map<string, Vector>) => [...map.values()].reduce(plus, zeros(size));
  const sameSection = (child: BooksAccount, parent: BooksAccount) => balanceSheetGroup(child) === balanceSheetGroup(parent);
  const tree = (map: Map<string, Vector>) => accountTree(map, set.accountById, size, sameSection);
  const currentAssets = sum(groups.current_assets);
  const capitalAssets = sum(groups.capital_assets);
  const currentLiabilities = sum(groups.current_liabilities);
  const longTermLiabilities = sum(groups.long_term_liabilities);
  const netAssets = sum(groups.net_assets);
  const totalAssets = plus(currentAssets, capitalAssets);
  const totalLiabilities = plus(currentLiabilities, longTermLiabilities);
  const totalNetAssets = plus(netAssets, unclosed);
  const balanceOptions = { scope: "balance" as const, withTotal: false };
  const subgroup = (id: string, label: string, map: Map<string, Vector>, total: Vector, favourable: "increase" | "decrease", emptyLabel: string): BooksReportRow[] => {
    const nodes = tree(map);
    if (!nodes.length) return [];
    return sectionBlock(id, label, nodes, total, periods, { ...balanceOptions, favourable, emptyLabel });
  };
  const assetRows = [
    ...subgroup("current_assets", "Current assets", groups.current_assets, currentAssets, "increase", "No current assets"),
    ...subgroup("capital_assets", "Capital assets", groups.capital_assets, capitalAssets, "increase", "No capital assets"),
  ];
  const liabilityRows = [
    ...subgroup("current_liabilities", "Current liabilities", groups.current_liabilities, currentLiabilities, "decrease", "No current liabilities"),
    ...subgroup("long_term_liabilities", "Long-term liabilities", groups.long_term_liabilities, longTermLiabilities, "decrease", "No long-term liabilities"),
  ];
  const netAssetRows: BooksReportRow[] = [
    ...treeRows("net_assets", tree(groups.net_assets), periods, balanceOptions),
    {
      id: "net_assets:unclosed",
      kind: "row",
      label: "Excess of revenues over expenses, not yet closed",
      calculated: true,
      drilldown: false,
      note: "Revenue less expenses posted but not yet closed to net assets. It keeps the statement in balance until the year-end closing entry is posted.",
      values: toValues(periods, unclosed),
    },
  ];
  const rows: BooksReportRow[] = [
    { id: "section:assets", kind: "section", label: "Assets", children: assetRows.length ? assetRows : [{ id: "assets:none", kind: "note", label: "No assets with posted lines" }] },
    { id: "subtotal:assets", kind: "subtotal", label: "Total assets", favourable: "increase", values: toValues(periods, totalAssets), drilldown: false },
    { id: "section:liabilities", kind: "section", label: "Liabilities", children: liabilityRows.length ? liabilityRows : [{ id: "liabilities:none", kind: "note", label: "No liabilities with posted lines" }] },
    { id: "subtotal:liabilities", kind: "subtotal", label: "Total liabilities", favourable: "decrease", values: toValues(periods, totalLiabilities), drilldown: false },
    { id: "section:net_assets", kind: "section", label: "Net assets", children: netAssetRows },
    { id: "subtotal:net_assets", kind: "subtotal", label: "Total net assets", values: toValues(periods, totalNetAssets), drilldown: false },
    { id: "total:liabilities_net_assets", kind: "total", label: "Total liabilities and net assets", values: toValues(periods, plus(totalLiabilities, totalNetAssets)), drilldown: false },
  ];
  const warnings: string[] = [];
  const difference = minus(totalAssets, plus(totalLiabilities, totalNetAssets));
  if (!isFilterActive(input.filter) && !isZero(difference)) {
    warnings.push("Assets do not equal liabilities and net assets. Review account types, opening balances and journal completeness.");
  }
  const summary = periods.map((period, index) => ({
    periodId: period.id,
    label: period.label,
    end: period.end,
    values: {
      currentAssets: currentAssets[index],
      currentLiabilities: currentLiabilities[index],
      workingCapital: currentAssets[index] - currentLiabilities[index],
      totalAssets: totalAssets[index],
      totalLiabilities: totalLiabilities[index],
      netAssets: totalNetAssets[index],
    },
  }));
  return basicReport("balance_sheet", input, set, { rows, summary, totalColumn: null }, warnings);
}

/**
 * Statement of operations (profit and loss): revenue and expenses posted in
 * each period, the excess of revenues over expenses, and a Total column.
 */
export function buildStatementOfOperations(input: ReportInput): BooksReport {
  const set = ledgerSet(input);
  const { periods } = input;
  const size = periods.length;
  const { moved } = movements(set.filtered, periods);
  const revenue = new Map<string, Vector>();
  const expenses = new Map<string, Vector>();
  for (const [id, vector] of moved) {
    const account = set.accountById.get(id);
    if (!account || isZero(vector)) continue;
    const section = accountSection(account.accountType);
    if (section === "income") revenue.set(id, scaled(vector, -1));
    if (section === "expenses") expenses.set(id, vector);
  }
  const sum = (map: Map<string, Vector>) => [...map.values()].reduce(plus, zeros(size));
  const sameSection = (child: BooksAccount, parent: BooksAccount) => accountSection(child.accountType) === accountSection(parent.accountType);
  const totalRevenue = sum(revenue);
  const totalExpenses = sum(expenses);
  const net = minus(totalRevenue, totalExpenses);
  const total = (vector: Vector) => vector.reduce((acc, value) => acc + value, 0);
  const options = { scope: "period" as const, withTotal: true };
  const rows: BooksReportRow[] = [
    ...sectionBlock("revenue", "Revenue", accountTree(revenue, set.accountById, size, sameSection), totalRevenue, periods, { ...options, favourable: "increase", emptyLabel: "No revenue posted" }),
    ...sectionBlock("expenses", "Expenses", accountTree(expenses, set.accountById, size, sameSection), totalExpenses, periods, { ...options, favourable: "decrease", emptyLabel: "No expenses posted" }),
    {
      id: "total:net",
      kind: "total",
      label: "Excess (deficiency) of revenues over expenses",
      calculated: true,
      favourable: "increase",
      note: "Total revenue less total expenses.",
      values: toValues(periods, net, total(net)),
      drilldown: false,
    },
  ];
  const summary = periods.map((period, index) => ({
    periodId: period.id,
    label: period.label,
    end: period.end,
    values: { revenue: totalRevenue[index], expenses: totalExpenses[index], net: net[index] },
  }));
  return basicReport("operations", input, set, { rows, summary, totalColumn: TOTAL_COLUMN });
}

/** Opening-balance entries set the starting cash; they are not a cash flow. */
const OPENING_SOURCES = new Set(["opening_balance"]);

/**
 * Cash flow (direct method): cash at the start of each period, money in and
 * out of the cash and bank accounts grouped by the other side of each entry
 * (operating, investing, financing activities), the net change and the cash at
 * the end. Transfers between cash accounts net to nothing; opening-balance
 * entries count toward the starting cash.
 */
export function buildCashFlow(input: ReportInput): BooksReport {
  const set = ledgerSet(input);
  const { periods } = input;
  const size = periods.length;
  const cashByEntry = new Map<string, boolean>();
  for (const row of set.all) if (isCashAccount(row.account)) cashByEntry.set(String(row.entry._id), true);
  const flows: Record<CashFlowActivity, Map<string, Vector>> = { operating: new Map(), investing: new Map(), financing: new Map() };
  const beginning = zeros(size);
  const cashMovement = zeros(size);
  let before = 0;
  for (const row of set.filtered) {
    const entryId = String(row.entry._id);
    if (!cashByEntry.get(entryId)) continue;
    const index = periodIndex(periods, row.entry.date);
    if (index >= size) continue;
    const opening = OPENING_SOURCES.has(String(row.entry.source ?? ""));
    if (isCashAccount(row.account)) {
      if (index < 0) before += row.signed;
      else if (opening) beginning[index] += row.signed;
      else cashMovement[index] += row.signed;
      continue;
    }
    if (index < 0 || opening) continue;
    const id = String(row.account._id);
    const activity = flows[cashFlowActivity(row.account)];
    const vector = activity.get(id) ?? zeros(size);
    // The other side of a cash entry: a credit brought money in.
    vector[index] -= row.signed;
    activity.set(id, vector);
  }
  // Starting cash of each period: everything before it, including opening
  // balances posted inside an earlier period.
  let running = before;
  const startCash = zeros(size);
  const endCash = zeros(size);
  for (let index = 0; index < size; index += 1) {
    running += beginning[index];
    startCash[index] = running;
    running += cashMovement[index];
    endCash[index] = running;
  }
  const sum = (map: Map<string, Vector>) => [...map.values()].reduce(plus, zeros(size));
  const sameActivity = (child: BooksAccount, parent: BooksAccount) => cashFlowActivity(child) === cashFlowActivity(parent) && accountSection(child.accountType) === accountSection(parent.accountType);
  const total = (vector: Vector) => vector.reduce((acc, value) => acc + value, 0);
  const options = { scope: "cash" as const, withTotal: true, favourable: "increase" as const };
  const activityRows = (id: CashFlowActivity, label: string, totalLabel: string) => {
    const map = flows[id];
    const nodes = accountTree(map, set.accountById, size, sameActivity);
    if (!nodes.length) return [];
    return sectionBlock(id, label, nodes, sum(map), periods, { ...options, totalLabel });
  };
  const movement = plus(plus(sum(flows.operating), sum(flows.investing)), sum(flows.financing));
  const rows: BooksReportRow[] = [
    {
      id: "cash:beginning",
      kind: "row",
      label: "Cash at the start of the period",
      calculated: true,
      drilldown: false,
      note: "Cash and bank balances carried in, including opening balances.",
      values: toValues(periods, startCash, startCash[0] ?? 0),
    },
    ...activityRows("operating", "Operating activities", "Net cash from operating activities"),
    ...activityRows("investing", "Investing activities", "Net cash from investing activities"),
    ...activityRows("financing", "Financing activities", "Net cash from financing activities"),
    { id: "total:movement", kind: "total", label: "Net change in cash", favourable: "increase", values: toValues(periods, movement, total(movement)), drilldown: false },
    { id: "cash:ending", kind: "total", label: "Cash at the end of the period", calculated: true, values: toValues(periods, endCash, endCash[size - 1] ?? 0), drilldown: false },
  ];
  const warnings: string[] = [];
  if (!isFilterActive(input.filter) && !isZero(minus(movement, cashMovement))) {
    warnings.push("Some entries move cash without a balancing line on another account, so the activities do not add up to the change in cash.");
  }
  const flowIn = zeros(size);
  const flowOut = zeros(size);
  for (const activity of Object.values(flows)) {
    for (const vector of activity.values()) {
      vector.forEach((value, index) => {
        if (value > 0) flowIn[index] += value;
        else flowOut[index] -= value;
      });
    }
  }
  const summary = periods.map((period, index) => ({
    periodId: period.id,
    label: period.label,
    end: period.end,
    values: { beginning: startCash[index], cashIn: flowIn[index], cashOut: flowOut[index], movement: movement[index], ending: endCash[index] },
  }));
  return basicReport("cash_flow", input, set, { rows, summary, totalColumn: TOTAL_COLUMN }, warnings);
}

export function buildBooksReport(kind: BooksReportKind, input: ReportInput): BooksReport {
  if (kind === "balance_sheet") return buildBalanceSheet(input);
  if (kind === "operations") return buildStatementOfOperations(input);
  if (kind === "cash_flow") return buildCashFlow(input);
  throw new Error("Unsupported report.");
}

/* -------------------------------------------------------------- drilldown */

export type ReportLine = {
  _id: string;
  journalEntryId: string;
  accountId: string;
  amountCents: number;
  side: string;
  lineOrder: number;
  description?: string;
  programCode?: string;
  fundRestrictionId?: string;
  financialTransactionId?: string;
  tagIds?: string[];
  entry: { _id: string; date: string; memo: string; entryNumber?: string; status: string; source?: string };
  account: { _id: string; code?: string; name: string; accountType: string; currency?: string; normalBalance?: string } | null;
};

function reportLine(row: Posted): ReportLine {
  return {
    _id: String(row.line._id),
    journalEntryId: String(row.line.journalEntryId),
    accountId: String(row.line.accountId),
    amountCents: row.line.amountCents,
    side: row.line.side,
    lineOrder: row.line.lineOrder ?? 0,
    description: row.line.description ?? undefined,
    programCode: row.line.programCode ?? undefined,
    fundRestrictionId: row.line.fundRestrictionId ? String(row.line.fundRestrictionId) : undefined,
    financialTransactionId: row.line.financialTransactionId ? String(row.line.financialTransactionId) : undefined,
    tagIds: row.line.tagIds?.length ? row.line.tagIds.map(String) : undefined,
    entry: { _id: String(row.entry._id), date: row.entry.date, memo: row.entry.memo ?? "", entryNumber: row.entry.entryNumber ?? undefined, status: row.entry.status, source: row.entry.source ?? undefined },
    account: { _id: String(row.account._id), code: row.account.code ?? undefined, name: row.account.name, accountType: row.account.accountType, currency: row.account.currency ?? undefined, normalBalance: row.account.normalBalance ?? undefined },
  };
}

/**
 * The journal lines behind one report amount, on the same basis and filter as
 * the report: every line through `end` for a balance, the period's lines for
 * revenue and expenses, and the other side of cash entries for cash flow.
 */
export function reportDrillLines(input: LedgerSetInput & { accountIds: string[]; scope: "balance" | "period" | "cash"; start?: string | null; end: string }): ReportLine[] {
  const set = ledgerSet(input);
  const ids = new Set(input.accountIds.map(String));
  const cashEntries = new Set<string>();
  if (input.scope === "cash") for (const row of set.all) if (isCashAccount(row.account)) cashEntries.add(String(row.entry._id));
  return set.filtered
    .filter((row) => {
      if (!ids.has(String(row.account._id)) || row.entry.date > input.end) return false;
      if (input.scope === "balance") return true;
      if (input.start && row.entry.date < input.start) return false;
      if (input.scope === "cash") return cashEntries.has(String(row.entry._id)) && !OPENING_SOURCES.has(String(row.entry.source ?? ""));
      return true;
    })
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || String(a.entry._id).localeCompare(String(b.entry._id)) || (a.line.lineOrder ?? 0) - (b.line.lineOrder ?? 0))
    .map(reportLine);
}

/* --------------------------------------------------------- general ledger */

export type AccountRef = { accountId: string; code?: string; name: string };

export type GeneralLedgerRow = {
  lineId: string;
  entryId: string;
  date: string;
  entryNumber?: string;
  memo: string;
  description?: string;
  source?: string;
  account: AccountRef;
  /** The other side of the entry: opposite-side lines, else every other line. */
  contraAccounts: AccountRef[];
  counterparty?: string;
  debitCents: number;
  creditCents: number;
  /** Running natural balance, when the ledger is filtered to one account. */
  balanceCents?: number;
  fundRestrictionId?: string;
  programCode?: string;
  financialTransactionId?: string;
  /** Finance tags on the line (one per tag group). */
  tagIds?: string[];
};

export type GeneralLedgerReport = {
  basis: AccountingBasis;
  currency: string;
  from: string;
  to: string;
  rows: GeneralLedgerRow[];
  totals: { debitCents: number; creditCents: number };
  /** Set when filtered to one account (and its sub-accounts). */
  account?: AccountRef & { accountType: string; creditNormal: boolean; openingBalanceCents: number; closingBalanceCents: number };
  warnings: string[];
  /** True when more rows matched than `limit`. */
  truncated: boolean;
  dimensionValues: DimensionValues;
};

const accountRef = (account: BooksAccount): AccountRef => ({ accountId: String(account._id), code: account.code ?? undefined, name: account.name });

/** Every account below `accountId` in the chart, and the account itself. */
export function accountWithDescendants(accounts: BooksAccount[], accountId: string) {
  const children = new Map<string, string[]>();
  for (const account of accounts) {
    if (!account.parentAccountId) continue;
    const list = children.get(String(account.parentAccountId)) ?? [];
    list.push(String(account._id));
    children.set(String(account.parentAccountId), list);
  }
  const out = new Set<string>();
  const stack = [String(accountId)];
  while (stack.length) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/**
 * General ledger for a date range: one row per posted line with the contra
 * account(s), memo, counterparty and debit / credit. Filtered to one account,
 * its sub-accounts come along and each row carries the running balance from
 * the opening balance at `from`.
 */
export function buildGeneralLedgerReport(input: LedgerSetInput & {
  from: string;
  to: string;
  accountId?: string | null;
  counterpartyNames?: Map<string, string>;
  /** Payee / payer on the bank transaction a line came from. */
  transactionCounterparties?: Map<string, string>;
  limit?: number;
}): GeneralLedgerReport {
  if (!isIsoDate(input.from) || !isIsoDate(input.to) || input.from > input.to) throw new Error("Choose a valid ledger date range.");
  const set = ledgerSet(input);
  const byEntry = new Map<string, Posted[]>();
  for (const row of set.all) {
    const list = byEntry.get(String(row.entry._id)) ?? [];
    list.push(row);
    byEntry.set(String(row.entry._id), list);
  }
  const scope = input.accountId ? accountWithDescendants(input.accounts, input.accountId) : null;
  const selected = input.accountId ? set.accountById.get(String(input.accountId)) : undefined;
  if (input.accountId && !selected) throw new Error("Account not found.");
  const creditNormal = selected ? isCreditNormal(selected) : false;
  const natural = (signed: number) => (creditNormal ? -signed : signed);
  let opening = 0;
  const inRange: Posted[] = [];
  for (const row of set.filtered) {
    if (scope && !scope.has(String(row.account._id))) continue;
    if (row.entry.date < input.from) {
      opening += natural(row.signed);
      continue;
    }
    if (row.entry.date > input.to) continue;
    inRange.push(row);
  }
  inRange.sort((a, b) => a.entry.date.localeCompare(b.entry.date) || String(a.entry.createdAtISO ?? "").localeCompare(String(b.entry.createdAtISO ?? "")) || String(a.entry._id).localeCompare(String(b.entry._id)) || (a.line.lineOrder ?? 0) - (b.line.lineOrder ?? 0));
  const counterpartyOf = (row: Posted, siblings: Posted[]) => {
    const direct = row.line.counterpartyId ? input.counterpartyNames?.get(String(row.line.counterpartyId)) : undefined;
    if (direct) return direct;
    for (const sibling of [row, ...siblings]) {
      const named = sibling.line.counterpartyId ? input.counterpartyNames?.get(String(sibling.line.counterpartyId)) : undefined;
      if (named) return named;
      const payee = sibling.line.financialTransactionId ? input.transactionCounterparties?.get(String(sibling.line.financialTransactionId)) : undefined;
      if (payee) return payee;
    }
    return undefined;
  };
  let running = opening;
  let debitCents = 0;
  let creditCents = 0;
  const limit = input.limit ?? 5000;
  const rows: GeneralLedgerRow[] = [];
  for (const row of inRange) {
    const siblings = (byEntry.get(String(row.entry._id)) ?? []).filter((other) => other.line._id !== row.line._id);
    const opposite = siblings.filter((other) => other.line.side !== row.line.side);
    const contra = (opposite.length ? opposite : siblings).map((other) => other.account);
    const contraAccounts = [...new Map(contra.map((account) => [String(account._id), accountRef(account)])).values()];
    running += natural(row.signed);
    const debit = row.line.side === "debit" ? row.line.amountCents : 0;
    const credit = row.line.side === "credit" ? row.line.amountCents : 0;
    debitCents += debit;
    creditCents += credit;
    if (rows.length >= limit) continue;
    rows.push({
      lineId: String(row.line._id),
      entryId: String(row.entry._id),
      date: row.entry.date,
      entryNumber: row.entry.entryNumber ?? undefined,
      memo: row.entry.memo ?? "",
      description: row.line.description ?? undefined,
      source: row.entry.source ?? undefined,
      account: accountRef(row.account),
      contraAccounts,
      counterparty: counterpartyOf(row, siblings),
      debitCents: debit,
      creditCents: credit,
      balanceCents: selected ? running : undefined,
      fundRestrictionId: row.line.fundRestrictionId ? String(row.line.fundRestrictionId) : undefined,
      programCode: row.line.programCode ?? undefined,
      financialTransactionId: row.line.financialTransactionId ? String(row.line.financialTransactionId) : undefined,
      tagIds: row.line.tagIds?.length ? row.line.tagIds.map(String) : undefined,
    });
  }
  return {
    basis: input.basis,
    currency: set.currency,
    from: input.from,
    to: input.to,
    rows,
    totals: { debitCents, creditCents },
    account: selected ? { ...accountRef(selected), accountType: selected.accountType, creditNormal, openingBalanceCents: opening, closingBalanceCents: running } : undefined,
    warnings: [...set.warnings],
    truncated: inRange.length > rows.length,
    dimensionValues: set.dimensionValues,
  };
}

/* ------------------------------------------------ journal-entry register */

export type JournalRegisterRow = {
  entryId: string;
  createdAtISO?: string;
  date: string;
  entryNumber?: string;
  reference?: string;
  memo: string;
  status: string;
  source: string;
  basis: JournalBasis;
  debitAccounts: AccountRef[];
  creditAccounts: AccountRef[];
  amountCents: number;
  currency?: string;
  /** Statement sections the entry touches, for the type tabs. */
  sections: string[];
  lineCount: number;
  /** Dated on or before the books close date. */
  locked: boolean;
  reviewFlags: string[];
};

export function buildJournalRegister(input: { accounts: BooksAccount[]; entries: BooksEntry[]; lines: BooksLine[]; closeDate?: string | null }): JournalRegisterRow[] {
  const accountById = new Map(input.accounts.map((account) => [String(account._id), account]));
  const byEntry = new Map<string, BooksLine[]>();
  for (const line of input.lines) {
    const list = byEntry.get(String(line.journalEntryId)) ?? [];
    list.push(line);
    byEntry.set(String(line.journalEntryId), list);
  }
  const unique = (refs: AccountRef[]) => [...new Map(refs.map((ref) => [ref.accountId, ref])).values()];
  return input.entries
    .map((entry) => {
      const lines = (byEntry.get(String(entry._id)) ?? []).sort((a, b) => (a.lineOrder ?? 0) - (b.lineOrder ?? 0));
      const accountsFor = (side: string) => unique(lines.filter((line) => line.side === side).map((line) => accountById.get(String(line.accountId))).filter((account): account is BooksAccount => Boolean(account)).map(accountRef));
      const sections = [...new Set(lines.map((line) => accountById.get(String(line.accountId))).filter((account): account is BooksAccount => Boolean(account)).map((account) => accountSection(account.accountType)))];
      const currency = lines.map((line) => accountById.get(String(line.accountId))?.currency).find(Boolean) ?? undefined;
      return {
        entryId: String(entry._id),
        createdAtISO: entry.createdAtISO ?? undefined,
        date: entry.date,
        entryNumber: entry.entryNumber ?? undefined,
        reference: entry.reference ?? undefined,
        memo: entry.memo ?? "",
        status: entry.status,
        source: String(entry.source ?? "manual"),
        basis: journalBasisOf(entry),
        debitAccounts: accountsFor("debit"),
        creditAccounts: accountsFor("credit"),
        amountCents: lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amountCents, 0),
        currency: currency ?? undefined,
        sections,
        lineCount: lines.length,
        locked: Boolean(input.closeDate && entry.date <= input.closeDate),
        reviewFlags: entry.reviewFlags ?? [],
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
}

/* ------------------------------------------- chart-of-accounts register */

export type ChartRegisterRow = BooksAccount & {
  section: string;
  creditNormal: boolean;
  /** Natural-sign amount on the opening-balance entry. */
  openingBalanceCents: number;
  /** Natural-sign posted balance today. */
  balanceCents: number;
  lineCount: number;
  depth: number;
};

export function buildChartRegister(input: { accounts: BooksAccount[]; entries: BooksEntry[]; lines: BooksLine[] }): ChartRegisterRow[] {
  const entryById = new Map(input.entries.filter((entry) => entry.status === "posted").map((entry) => [String(entry._id), entry]));
  const totals = new Map<string, { opening: number; balance: number; count: number }>();
  for (const line of input.lines) {
    const entry = entryById.get(String(line.journalEntryId));
    if (!entry || !Number.isSafeInteger(line.amountCents)) continue;
    const signed = line.side === "debit" ? line.amountCents : -line.amountCents;
    const current = totals.get(String(line.accountId)) ?? { opening: 0, balance: 0, count: 0 };
    current.balance += signed;
    current.count += 1;
    if (OPENING_SOURCES.has(String(entry.source ?? ""))) current.opening += signed;
    totals.set(String(line.accountId), current);
  }
  const byId = new Map(input.accounts.map((account) => [String(account._id), account]));
  const depthOf = (account: BooksAccount) => {
    let depth = 0;
    let current = account;
    const seen = new Set([String(account._id)]);
    while (current.parentAccountId && byId.has(String(current.parentAccountId)) && !seen.has(String(current.parentAccountId))) {
      seen.add(String(current.parentAccountId));
      current = byId.get(String(current.parentAccountId)) as BooksAccount;
      depth += 1;
    }
    return depth;
  };
  return input.accounts.map((account) => {
    const creditNormal = isCreditNormal(account);
    const total = totals.get(String(account._id)) ?? { opening: 0, balance: 0, count: 0 };
    const sign = creditNormal ? -1 : 1;
    return {
      ...account,
      section: accountSection(account.accountType),
      creditNormal,
      openingBalanceCents: sign * total.opening,
      balanceCents: sign * total.balance,
      lineCount: total.count,
      depth: depthOf(account),
    };
  });
}

/* ------------------------------------------------------------ lock dates */

/**
 * The refusal for a write that touches the closed books: posting, editing or
 * voiding an entry dated on or before the close date. Returns null when the
 * dates are open.
 */
export function closedBooksError(closeDate: string | null | undefined, dates: Array<string | null | undefined>, action = "posted, edited or voided") {
  if (!closeDate) return null;
  const locked = dates.filter((date): date is string => typeof date === "string" && date <= closeDate).sort();
  if (!locked.length) return null;
  return `The books are closed through ${closeDate}, so entries dated ${locked[0]} can't be ${action}. An admin can move the close date in Books settings.`;
}
