/**
 * Pure selectors for the "Top payees / Top categories" lists and the
 * months-of-operating-reserve figure. Like series.ts, they only reshape the
 * imported bank and card transactions; nothing is estimated.
 */
import { isInternalTransfer } from "../../../../shared/transferCategories";
import { addDays, addMonths, startOfMonth, type DateRange } from "../../../components/charts";
import type { FinanceTxn } from "./series";

export type FlowDirection = "out" | "in";
export type FlowGrouping = "payee" | "category";

/** Label used for transactions without a category. */
export const UNCATEGORISED_LABEL = "Uncategorised";

export type TopFlowRow = {
  key: string;
  label: string;
  cents: number;
  count: number;
  /** Share of the direction's total in the range, 0..1. */
  share: number;
  /** What the Transactions table should filter on when the row is opened. */
  filter: { field: "counterparty" | "description" | "category"; value: string | null };
};

export type TopFlows = { rows: TopFlowRow[]; total: number; groupCount: number; otherCents: number };

function inRange(t: FinanceTxn, range: DateRange) {
  return t.date >= range.start && t.date <= range.end;
}

function matchesDirection(t: FinanceTxn, direction: FlowDirection) {
  return direction === "out" ? t.amountCents < 0 : t.amountCents > 0;
}

/** The payee a person would recognise: the counterparty, else the bank description. */
export function payeeOf(t: FinanceTxn): { label: string; field: "counterparty" | "description" } | null {
  const counterparty = String(t.counterparty ?? "").trim();
  if (counterparty) return { label: counterparty, field: "counterparty" };
  const description = String(t.description ?? "").trim();
  return description ? { label: description, field: "description" } : null;
}

/**
 * The largest payees or categories for one direction of money in `range`,
 * biggest first. Transfers between the organisation's own accounts are left
 * out because they are neither spending nor income.
 */
export function topFlows(txns: FinanceTxn[], range: DateRange, grouping: FlowGrouping, direction: FlowDirection, limit = 5): TopFlows {
  const groups = new Map<string, TopFlowRow>();
  let total = 0;
  for (const t of txns) {
    if (!inRange(t, range) || !matchesDirection(t, direction) || isInternalTransfer(t)) continue;
    const cents = Math.abs(t.amountCents);
    total += cents;
    let label: string;
    let filter: TopFlowRow["filter"];
    if (grouping === "category") {
      const category = String(t.category ?? "").trim();
      label = category || UNCATEGORISED_LABEL;
      filter = { field: "category", value: category || null };
    } else {
      const payee = payeeOf(t);
      if (!payee) continue;
      label = payee.label;
      filter = { field: payee.field, value: payee.label };
    }
    const key = `${filter.field}:${label.toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.cents += cents;
      existing.count += 1;
    } else {
      groups.set(key, { key, label, cents, count: 1, share: 0, filter });
    }
  }
  const sorted = [...groups.values()].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  const rows = sorted.slice(0, limit).map((row) => ({ ...row, share: total > 0 ? row.cents / total : 0 }));
  const shown = rows.reduce((sum, row) => sum + row.cents, 0);
  return { rows, total, groupCount: sorted.length, otherCents: total - shown };
}

export type OperatingReserve = {
  /** Months the unrestricted cash would cover; null when there is not enough history. */
  months: number | null;
  unrestrictedCents: number;
  averageMonthlyOutflowCents: number;
  /** Complete calendar months averaged (12 when the history allows, else 6, else what exists). */
  windowMonths: number;
  window: DateRange | null;
};

/** Fewest complete months of history before the figure is shown. */
export const MIN_RESERVE_MONTHS = 3;

/**
 * Months of operating reserve: unrestricted cash divided by the average
 * monthly money out over the last 12 complete months (6 when the imported
 * history is shorter). Internal transfers are excluded so paying the card
 * from chequing is not counted twice.
 */
export function operatingReserve(txns: FinanceTxn[], unrestrictedCents: number, today: string): OperatingReserve {
  const thisMonth = startOfMonth(today);
  const earliest = txns[0]?.date ? startOfMonth(txns[0].date) : null;
  // Complete months with history before the current month.
  const available = earliest && earliest < thisMonth ? Math.max(0, monthsUntil(earliest, thisMonth)) : 0;
  const windowMonths = available >= 12 ? 12 : available >= 6 ? 6 : available;
  if (windowMonths < MIN_RESERVE_MONTHS) {
    return { months: null, unrestrictedCents, averageMonthlyOutflowCents: 0, windowMonths, window: null };
  }
  const start = addMonths(thisMonth, -windowMonths);
  const window = { start, end: lastDayBefore(thisMonth) };
  let outflow = 0;
  for (const t of txns) {
    if (!inRange(t, window) || t.amountCents >= 0 || isInternalTransfer(t)) continue;
    outflow += -t.amountCents;
  }
  const average = Math.round(outflow / windowMonths);
  const months = average > 0 ? Math.max(0, unrestrictedCents) / average : null;
  return { months, unrestrictedCents, averageMonthlyOutflowCents: average, windowMonths, window };
}

function monthsUntil(fromMonthStart: string, toMonthStart: string) {
  const [fy, fm] = fromMonthStart.split("-").map(Number);
  const [ty, tm] = toMonthStart.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function lastDayBefore(monthStart: string) {
  return addDays(monthStart, -1);
}

/** "4.2" for the tile; one decimal under 10 months, whole months above. */
export function formatReserveMonths(months: number) {
  if (months >= 10) return String(Math.round(months));
  return (Math.round(months * 10) / 10).toFixed(1);
}

