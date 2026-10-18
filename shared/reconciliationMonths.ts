/**
 * Reconciliation by account and month: the month strip's status for each
 * month of a year, the running balance down a month's transactions, and
 * whether a statement can be auto-reconciled in one click. Pure arithmetic
 * over statement periods (shared/reconciliationPeriods.ts) and bank lines,
 * shared by the portable handlers and the reconciliation screen.
 *
 * A month's status comes from the statement periods that overlap it:
 *   - none                         → Not started
 *   - any out of balance           → Difference (the period's difference)
 *   - any in progress, off         → Difference $X
 *   - any in progress, balanced    → In progress (ready to mark reconciled)
 *   - closed and covering it all   → Reconciled (auto-reconciled when every
 *                                    covering period was)
 *   - closed but only partly       → In progress
 * Months that haven't started yet are "upcoming".
 *
 * Auto-reconcile: once every line in an open statement is either matched or
 * categorised and clearing the categorised ones brings the difference to
 * $0.00, the statement can be completed in one step (categorised lines are
 * cleared as "categorised").
 */

import { isUncategorized } from "./transactionRules";

export type MonthStatusKind = "reconciled" | "in_progress" | "not_started" | "difference" | "upcoming";

export type MonthPeriod = {
  _id: string;
  startDate: string;
  endDate: string;
  /** shared/reconciliationPeriods effective status. */
  effectiveStatus: string;
  differenceCents: number;
};

export type MonthStatus = {
  /** YYYY-MM */
  month: string;
  kind: MonthStatusKind;
  label: string;
  /** Set for "difference". */
  differenceCents?: number;
  /** Every covering period was auto-reconciled. */
  auto?: boolean;
  /** The period to open for this month (the open one first, else the latest). */
  periodId?: string;
  transactionCount: number;
};

export const MONTH_STATUS_LABELS: Record<MonthStatusKind, string> = {
  reconciled: "Reconciled",
  in_progress: "In progress",
  not_started: "Not started",
  difference: "Difference",
  upcoming: "Upcoming",
};

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function formatDifference(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents) / 100;
  return `${sign}$${abs.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const isClosed = (status: string) => status === "completed" || status === "auto_reconciled";

/** Whether the periods, together, cover every day from `start` to `end`. */
function covers(periods: readonly MonthPeriod[], start: string, end: string): boolean {
  let cursor = start;
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const period of sorted) {
    if (period.startDate > cursor) return false;
    if (period.endDate >= cursor) {
      if (period.endDate >= end) return true;
      const [y, m, d] = period.endDate.split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      cursor = next.toISOString().slice(0, 10);
    }
  }
  return cursor > end;
}

/** The status of one month for one account. */
export function monthStatus(
  month: string,
  periods: readonly MonthPeriod[],
  transactionDates: readonly string[],
  today: string,
): MonthStatus {
  const { start, end } = monthBounds(month);
  const transactionCount = transactionDates.filter((date) => date >= start && date <= end).length;
  const base = { month, transactionCount };
  if (start > today) return { ...base, kind: "upcoming", label: MONTH_STATUS_LABELS.upcoming };
  const covering = periods.filter((period) => period.startDate <= end && period.endDate >= start);
  if (!covering.length) return { ...base, kind: "not_started", label: MONTH_STATUS_LABELS.not_started };
  const open = covering.find((period) => period.effectiveStatus === "in_progress");
  const off = covering.find((period) => period.effectiveStatus === "out_of_balance");
  const latest = [...covering].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  if (off) {
    return {
      ...base,
      kind: "difference",
      differenceCents: off.differenceCents,
      label: off.differenceCents !== 0 ? `Difference ${formatDifference(off.differenceCents)}` : "Changed since reconciled",
      periodId: off._id,
    };
  }
  if (open) {
    if (open.differenceCents !== 0) {
      return { ...base, kind: "difference", differenceCents: open.differenceCents, label: `Difference ${formatDifference(open.differenceCents)}`, periodId: open._id };
    }
    return { ...base, kind: "in_progress", label: MONTH_STATUS_LABELS.in_progress, periodId: open._id };
  }
  const closed = covering.filter((period) => isClosed(period.effectiveStatus));
  // Only days up to today need covering in the current month.
  const coverEnd = end > today ? today : end;
  if (closed.length === covering.length && covers(closed, start, coverEnd)) {
    const auto = closed.every((period) => period.effectiveStatus === "auto_reconciled");
    return { ...base, kind: "reconciled", label: auto ? "Auto-reconciled" : MONTH_STATUS_LABELS.reconciled, auto, periodId: latest._id };
  }
  return { ...base, kind: "in_progress", label: MONTH_STATUS_LABELS.in_progress, periodId: latest._id };
}

export function monthStatusesForYear(
  year: number,
  periods: readonly MonthPeriod[],
  transactionDates: readonly string[],
  today: string,
): MonthStatus[] {
  return monthsOfYear(year).map((month) => monthStatus(month, periods, transactionDates, today));
}

/* -------------------------------------------------------- running balance */

export type BalanceLine = { _id: string; date: string; amountCents: number };

/**
 * Lines in date order, each with the account balance after it. `openingCents`
 * is the balance at the start of the first line's day.
 */
export function withRunningBalance<T extends BalanceLine>(lines: readonly T[], openingCents: number): Array<T & { balanceCents: number }> {
  let balance = openingCents;
  return [...lines]
    .sort((a, b) => a.date.localeCompare(b.date) || String(a._id).localeCompare(String(b._id)))
    .map((line) => {
      balance += line.amountCents;
      return { ...line, balanceCents: balance };
    });
}

/** Balance at the start of `date`, working back from a known current balance. */
export function balanceBefore(currentBalanceCents: number, lines: readonly BalanceLine[], date: string): number {
  return currentBalanceCents - lines.filter((line) => line.date >= date).reduce((sum, line) => sum + line.amountCents, 0);
}

/* ---------------------------------------------------------- auto-reconcile */

export type AutoReconcileLine = {
  _id: string;
  amountCents: number;
  reconciledAtISO?: string | null;
  category?: string | null;
  accountingAccountId?: string | null;
};

export type AutoReconcileReadiness = {
  ready: boolean;
  /** Difference after clearing every categorised line. */
  projectedDifferenceCents: number;
  /** Categorised lines that would be cleared. */
  toClearIds: string[];
  /** Lines neither matched nor categorised. */
  blockingCount: number;
  reason?: string;
};

export function isCategorised(line: Pick<AutoReconcileLine, "category" | "accountingAccountId">): boolean {
  return Boolean(line.accountingAccountId) || !isUncategorized({ category: line.category ?? undefined });
}

export function autoReconcileReadiness(
  beginningBalanceCents: number,
  endingBalanceCents: number,
  lines: readonly AutoReconcileLine[],
): AutoReconcileReadiness {
  let cleared = beginningBalanceCents;
  const toClearIds: string[] = [];
  let blockingCount = 0;
  for (const line of lines) {
    if (line.reconciledAtISO) {
      cleared += line.amountCents;
    } else if (isCategorised(line)) {
      cleared += line.amountCents;
      toClearIds.push(String(line._id));
    } else {
      blockingCount += 1;
    }
  }
  const projectedDifferenceCents = endingBalanceCents - cleared;
  let reason: string | undefined;
  if (!lines.length) reason = "There are no transactions in this statement.";
  else if (blockingCount) reason = `${blockingCount} transaction${blockingCount === 1 ? " is" : "s are"} neither matched nor categorised.`;
  else if (projectedDifferenceCents !== 0) reason = `Clearing every categorised line still leaves a difference of ${formatDifference(projectedDifferenceCents)}.`;
  return { ready: !reason, projectedDifferenceCents, toClearIds, blockingCount, reason };
}
