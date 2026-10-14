/**
 * Pure selectors that turn the existing finance queries (accounts, bank
 * transactions, the hub summary) into chart series. Nothing here invents a
 * number: balances are derived backwards from the current bank balance by
 * undoing each imported transaction, and periods with no history are left
 * empty rather than filled.
 */
import {
  addDays,
  addMonths,
  daysBetween,
  formatMonth,
  formatMonthLong,
  monthKey,
  monthsBetween,
  startOfMonth,
  type DateRange,
  type FlowRow,
  type TimeRow,
} from "../../../components/charts";

export type FinanceTxn = { _id?: string; date: string; amountCents: number; accountId?: string; category?: string };
export type FinanceAccount = { _id: string; accountType?: string };

export type RangePreset = "3M" | "6M" | "12M" | "FYTD" | "ALL";

export const RANGE_PRESETS: Array<{ id: RangePreset; label: string; title: string }> = [
  { id: "3M", label: "3M", title: "Last 3 months" },
  { id: "6M", label: "6M", title: "Last 6 months" },
  { id: "12M", label: "12M", title: "Last 12 months" },
  { id: "FYTD", label: "FYTD", title: "Fiscal year to date" },
  { id: "ALL", label: "All", title: "All history" },
];

const BANK_TYPES = new Set(["Bank", "Credit"]);

/** Transactions on bank and credit-card accounts (all rows when accounts are unknown). */
export function bankTransactions(txns: FinanceTxn[], accounts: FinanceAccount[]): FinanceTxn[] {
  const valid = txns.filter((t) => typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(t.date) && Number.isFinite(t.amountCents));
  const bankIds = new Set(accounts.filter((a) => BANK_TYPES.has(String(a.accountType))).map((a) => String(a._id)));
  const scoped = bankIds.size ? valid.filter((t) => !t.accountId || bankIds.has(String(t.accountId))) : valid;
  return scoped.map((t) => ({ ...t, date: t.date.slice(0, 10) })).sort((a, b) => a.date.localeCompare(b.date));
}

/** First day of the fiscal year containing `today`, from a "MM-DD" year end. */
export function fiscalYearStart(today: string, fiscalYearEnd?: string | null): string {
  const match = /^(\d{2})-(\d{2})$/.exec(String(fiscalYearEnd ?? ""));
  if (!match) return `${today.slice(0, 4)}-01-01`;
  const year = Number(today.slice(0, 4));
  const endThisYear = `${year}-${match[1]}-${match[2]}`;
  const lastEnd = endThisYear < today ? endThisYear : `${year - 1}-${match[1]}-${match[2]}`;
  return addDays(lastEnd, 1);
}

export function presetRange(preset: RangePreset, today: string, opts: { earliest?: string | null; fiscalYearEnd?: string | null }): DateRange {
  const monthStart = startOfMonth(today);
  switch (preset) {
    case "3M":
      return { start: addMonths(monthStart, -2), end: today };
    case "6M":
      return { start: addMonths(monthStart, -5), end: today };
    case "12M":
      return { start: addMonths(monthStart, -11), end: today };
    case "FYTD":
      return { start: fiscalYearStart(today, opts.fiscalYearEnd), end: today };
    case "ALL":
    default: {
      const earliest = opts.earliest && opts.earliest < today ? startOfMonth(opts.earliest) : addMonths(monthStart, -11);
      return { start: earliest, end: today };
    }
  }
}

/** The equally long period immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const length = daysBetween(range.start, range.end) + 1;
  return { start: addDays(range.start, -length), end: addDays(range.start, -1) };
}

/** Pick a default window: 12 months when it has activity, otherwise all history. */
export function defaultPreset(txns: FinanceTxn[], today: string): RangePreset {
  const start = presetRange("12M", today, {}).start;
  const months = new Set(txns.filter((t) => t.date >= start && t.date <= today).map((t) => monthKey(t.date)));
  return months.size >= 2 ? "12M" : "ALL";
}

export type FlowTotals = { inflow: number; outflow: number; net: number; inCount: number; outCount: number };

export function flowTotals(txns: FinanceTxn[], range: DateRange): FlowTotals {
  let inflow = 0;
  let outflow = 0;
  let inCount = 0;
  let outCount = 0;
  for (const t of txns) {
    if (t.date < range.start || t.date > range.end) continue;
    if (t.amountCents >= 0) {
      inflow += t.amountCents;
      inCount += 1;
    } else {
      outflow += -t.amountCents;
      outCount += 1;
    }
  }
  return { inflow, outflow, net: inflow - outflow, inCount, outCount };
}

/** Balance lookup derived backwards from the current balance. */
export function balanceLookup(txns: FinanceTxn[], currentBalance: number) {
  const dates = txns.map((t) => t.date);
  const prefix: number[] = [];
  let running = 0;
  for (const t of txns) {
    running += t.amountCents;
    prefix.push(running);
  }
  const total = running;
  const opening = currentBalance - total;
  const first = dates[0] ?? null;
  /** Closing balance at the end of `date`; null before the first imported transaction. */
  return (date: string): number | null => {
    if (!first || date < first) return null;
    let lo = 0;
    let hi = dates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (dates[mid] <= date) lo = mid;
      else hi = mid - 1;
    }
    return opening + prefix[lo];
  };
}

/**
 * Daily (or weekly, for multi-year windows) closing balances across `range`,
 * with an optional comparison series shifted from the previous period.
 */
export function balanceRows(txns: FinanceTxn[], currentBalance: number, range: DateRange, compare: boolean): TimeRow[] {
  const balanceAt = balanceLookup(txns, currentBalance);
  const span = daysBetween(range.start, range.end);
  const step = span > 800 ? 7 : 1;
  const offset = span + 1;
  const rows: TimeRow[] = [];
  for (let d = 0; d <= span; d += step) {
    const date = addDays(range.start, d);
    const row: TimeRow = { date, balance: balanceAt(date) };
    if (compare) row.previous = balanceAt(addDays(date, -offset));
    rows.push(row);
  }
  const last = rows[rows.length - 1];
  if (last && last.date !== range.end) {
    const row: TimeRow = { date: range.end, balance: balanceAt(range.end) };
    if (compare) row.previous = balanceAt(addDays(range.end, -offset));
    rows.push(row);
  }
  return rows;
}

/** Monthly money in / money out across `range`; months outside `focus` are dimmed. */
export function monthlyFlowRows(txns: FinanceTxn[], range: DateRange, focus?: DateRange | null): FlowRow[] {
  const months = monthsBetween(range.start, range.end);
  const byMonth = new Map(months.map((m) => [m, { inflow: 0, outflow: 0 }]));
  for (const t of txns) {
    if (t.date < range.start || t.date > range.end) continue;
    const bucket = byMonth.get(monthKey(t.date));
    if (!bucket) continue;
    if (t.amountCents >= 0) bucket.inflow += t.amountCents;
    else bucket.outflow += -t.amountCents;
  }
  const spansYears = months.length > 0 && months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  return months.map((m, i) => ({
    key: m,
    label: formatMonth(m, spansYears && (i === 0 || m.endsWith("-01"))),
    tooltipLabel: formatMonthLong(m),
    inflow: byMonth.get(m)!.inflow,
    outflow: byMonth.get(m)!.outflow,
    dimmed: focus ? monthKey(focus.end) < m || monthKey(focus.start) > m : false,
  }));
}

/** Month-end closing balances for tables and sparklines. */
export function monthEndBalances(rows: TimeRow[], key = "balance"): Array<{ month: string; value: number | null; previous?: number | null }> {
  const out = new Map<string, { month: string; value: number | null; previous?: number | null }>();
  for (const row of rows) {
    out.set(monthKey(row.date), {
      month: monthKey(row.date),
      value: (row[key] as number | null) ?? null,
      previous: row.previous === undefined ? undefined : ((row.previous as number | null) ?? null),
    });
  }
  return [...out.values()];
}
