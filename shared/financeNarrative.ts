/**
 * Written insights for the Financials overview: cash position and runway,
 * the money-out trend against a comparison period, and the top sources of
 * money in. Deterministic sentences computed from bank and card
 * transactions (no model writes them), so the same data always reads the same
 * way. Internal transfers (paying the card from chequing) are left out of
 * every figure.
 *
 * Pure TypeScript: no Convex, DOM or Node imports. Covered by
 * scripts/check-books-reports.ts.
 */
import { isInternalTransfer } from "./transferCategories";

export type NarrativeTxn = { date: string; amountCents: number; category?: string | null; counterparty?: string | null; description?: string | null };
export type NarrativeRange = { start: string; end: string };
export type CompareMode = "previous" | "lastYear";

/** Whole months averaged for the burn rate. */
export const RUNWAY_WINDOW_MONTHS = 3;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function shiftMonth(monthIso: string, offset: number) {
  const index = Number(monthIso.slice(0, 4)) * 12 + Number(monthIso.slice(5, 7)) - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** Shift an ISO date by whole years, clamping Feb 29. */
export function shiftYears(iso: string, years: number) {
  const year = Number(iso.slice(0, 4)) + years;
  let day = iso.slice(8, 10);
  if (iso.slice(5, 7) === "02" && day === "29" && !((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) day = "28";
  return `${year}-${iso.slice(5, 7)}-${day}`;
}

/** The comparison window: the equally long period just before, or the same dates a year earlier. */
export function comparisonRange(range: NarrativeRange, mode: CompareMode): NarrativeRange {
  if (mode === "lastYear") return { start: shiftYears(range.start, -1), end: shiftYears(range.end, -1) };
  const length = daysBetween(range.start, range.end) + 1;
  return { start: addDays(range.start, -length), end: addDays(range.start, -1) };
}

/** "$62.4K", "$950", "$1.2M": short money for sentences. */
export function shortMoney(cents: number) {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  if (dollars >= 1_000_000) return `${sign}$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 10_000) return `${sign}$${(dollars / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(dollars).toLocaleString("en-CA")}`;
}

function monthLabel(monthIso: string, withYear: boolean) {
  const label = MONTHS[Number(monthIso.slice(5, 7)) - 1];
  return withYear ? `${label} ${monthIso.slice(0, 4)}` : label;
}

function counted(txns: NarrativeTxn[]) {
  return txns.filter((txn) => /^\d{4}-\d{2}-\d{2}/.test(txn.date) && Number.isFinite(txn.amountCents) && !isInternalTransfer(txn));
}

export type Runway = {
  balanceCents: number;
  /** The fully completed months averaged, oldest first (empty when history is too short). */
  months: Array<{ month: string; inflowCents: number; outflowCents: number; netCents: number }>;
  window: NarrativeRange | null;
  /** Average monthly money out less money in; positive when cash is shrinking. */
  averageNetBurnCents: number;
  /** Months the balance lasts at that burn; null when there is no burn or not enough history. */
  runwayMonths: number | null;
  status: "burning" | "not_burning" | "not_enough_history";
  sentence: string;
};

/**
 * Cash position and runway: the balance divided by the average monthly net
 * burn (money out less money in) over the last three fully completed months.
 * When money in kept up with money out there is no burn, so runway is not
 * applicable rather than infinite.
 */
export function runway(txns: NarrativeTxn[], balanceCents: number, today: string, windowMonths = RUNWAY_WINDOW_MONTHS): Runway {
  const rows = counted(txns);
  const thisMonth = monthStart(today);
  const firstMonth = shiftMonth(thisMonth, -windowMonths);
  const earliest = rows.reduce<string | null>((min, txn) => (min == null || txn.date < min ? txn.date : min), null);
  const balance = `Your bank and card balances total ${shortMoney(balanceCents)}`;
  if (!earliest || monthStart(earliest) > firstMonth) {
    return {
      balanceCents,
      months: [],
      window: null,
      averageNetBurnCents: 0,
      runwayMonths: null,
      status: "not_enough_history",
      sentence: `${balance}. Runway needs ${windowMonths} fully completed months of transactions, so it isn't shown yet.`,
    };
  }
  const months = Array.from({ length: windowMonths }, (_, index) => ({ month: shiftMonth(firstMonth, index), inflowCents: 0, outflowCents: 0, netCents: 0 }));
  const byMonth = new Map(months.map((row) => [row.month, row]));
  for (const txn of rows) {
    const row = byMonth.get(monthStart(txn.date));
    if (!row) continue;
    if (txn.amountCents >= 0) row.inflowCents += txn.amountCents;
    else row.outflowCents -= txn.amountCents;
  }
  for (const row of months) row.netCents = row.inflowCents - row.outflowCents;
  const window = { start: firstMonth, end: addDays(thisMonth, -1) };
  const averageNetBurnCents = Math.round(-months.reduce((sum, row) => sum + row.netCents, 0) / windowMonths);
  const spansYears = firstMonth.slice(0, 4) !== months[months.length - 1].month.slice(0, 4);
  const windowLabel = `${monthLabel(firstMonth, spansYears)}–${monthLabel(months[months.length - 1].month, true)}`;
  const setting = `Runway uses the last ${windowMonths} fully completed months (${windowLabel}).`;
  if (averageNetBurnCents <= 0) {
    const surplus = -averageNetBurnCents;
    return {
      balanceCents,
      months,
      window,
      averageNetBurnCents,
      runwayMonths: null,
      status: "not_burning",
      sentence: surplus === 0
        ? `${balance}. Money in matched money out over the last ${windowMonths} fully completed months, so runway isn't applicable. ${setting}`
        : `${balance}, and money in exceeded money out by ${shortMoney(surplus)} a month on average, so there is no burn and runway isn't applicable. ${setting}`,
    };
  }
  const runwayMonths = Math.max(0, balanceCents) / averageNetBurnCents;
  const lasts = balanceCents <= 0
    ? "with no cash left to cover it"
    : runwayMonths >= 24
      ? "so cash lasts more than two years at that rate"
      : `so cash lasts about ${runwayMonths >= 10 ? Math.round(runwayMonths) : (Math.round(runwayMonths * 10) / 10).toFixed(1)} months at that rate`;
  return {
    balanceCents,
    months,
    window,
    averageNetBurnCents,
    runwayMonths,
    status: "burning",
    sentence: `${balance} with a net burn of ${shortMoney(averageNetBurnCents)} a month, ${lasts}. ${setting}`,
  };
}

export type MoneyOutTrend = {
  currentCents: number;
  comparisonCents: number;
  /** Change as a ratio of the comparison period; null when it had no money out. */
  change: number | null;
  covered: boolean;
  sentence: string;
};

const COMPARE_LABEL: Record<CompareMode, string> = { previous: "the previous period", lastYear: "the same period last year" };

/** Money out in `range` against the comparison period. */
export function moneyOutTrend(txns: NarrativeTxn[], range: NarrativeRange, mode: CompareMode): MoneyOutTrend {
  const rows = counted(txns);
  const prior = comparisonRange(range, mode);
  const outIn = (window: NarrativeRange) => rows.reduce((sum, txn) => (txn.amountCents < 0 && txn.date >= window.start && txn.date <= window.end ? sum - txn.amountCents : sum), 0);
  const currentCents = outIn(range);
  const comparisonCents = outIn(prior);
  const earliest = rows.reduce<string | null>((min, txn) => (min == null || txn.date < min ? txn.date : min), null);
  const covered = Boolean(earliest && earliest.slice(0, 7) <= prior.start.slice(0, 7));
  const label = COMPARE_LABEL[mode];
  if (!covered) {
    return { currentCents, comparisonCents, change: null, covered, sentence: `Money out was ${shortMoney(currentCents)}. The transactions don't reach back to ${label}, so there is no comparison.` };
  }
  const change = comparisonCents > 0 ? (currentCents - comparisonCents) / comparisonCents : null;
  let trend: string;
  if (change == null) trend = currentCents > 0 ? `up from nothing in ${label}` : `the same as ${label}`;
  else if (Math.abs(change) < 0.005) trend = `level with ${label}`;
  else trend = `${change > 0 ? "up" : "down"} ${Math.abs(Math.round(change * 1000) / 10).toFixed(1)}% from ${shortMoney(comparisonCents)} in ${label}`;
  return { currentCents, comparisonCents, change, covered, sentence: `Money out was ${shortMoney(currentCents)}, ${trend}.` };
}

export type MoneyInSource = { label: string; cents: number; share: number };
export type TopMoneyIn = { rows: MoneyInSource[]; totalCents: number; sentence: string };

/** Top sources of money in (by category, else payer), each with its share of the total. */
export function topMoneyInSources(txns: NarrativeTxn[], range: NarrativeRange, limit = 3): TopMoneyIn {
  const totals = new Map<string, number>();
  let totalCents = 0;
  for (const txn of counted(txns)) {
    if (txn.amountCents <= 0 || txn.date < range.start || txn.date > range.end) continue;
    const label = String(txn.category ?? "").trim() || String(txn.counterparty ?? "").trim() || "Uncategorised";
    totals.set(label, (totals.get(label) ?? 0) + txn.amountCents);
    totalCents += txn.amountCents;
  }
  const rows = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, cents]) => ({ label, cents, share: totalCents ? cents / totalCents : 0 }));
  if (!rows.length) return { rows, totalCents, sentence: "No money came in during this range." };
  const percent = (share: number) => `${Math.round(share * 100)}%`;
  const parts = rows.map((row) => `${row.label} ${shortMoney(row.cents)} (${percent(row.share)})`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const covered = rows.reduce((sum, row) => sum + row.share, 0);
  return {
    rows,
    totalCents,
    sentence: `Money in totalled ${shortMoney(totalCents)}. The top ${rows.length === 1 ? "source was" : `${rows.length} sources were`} ${list}${rows.length > 1 ? `, together ${percent(covered)} of the total` : ""}.`,
  };
}
