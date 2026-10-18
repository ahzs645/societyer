/**
 * Bank statement reconciliation periods: pure balance arithmetic and the
 * "balances no longer match" check, shared by the portable handlers and UI.
 *
 * A period covers one bank account between statement start and end dates.
 *   cleared balance = beginning balance + cleared deposits − cleared payments
 *   difference      = statement ending balance − cleared balance
 * A transaction is cleared once it is reconciled (matched to a record or
 * marked manually). A period can only be completed when the difference is
 * exactly $0.00. Completion snapshots a fingerprint of every transaction in the
 * period; if a line inside a completed period is later added, edited, removed
 * or unmatched, the fingerprint changes and the period reads out of balance.
 */

/**
 * Why a bank line can't be re-matched, unmatched, split or recoded here: a bill or
 * invoice payment holds it (`matchedKind` "bill" / "invoice"), and only
 * removing that payment puts the line back as it was. Null when it's free.
 */
export function paymentLinkRefusal(matchedKind: unknown, action: "match it to something else" | "unmatch it" | "split it" | "change its category"): string | null {
  if (matchedKind !== "bill" && matchedKind !== "invoice") return null;
  return `This transaction is linked to ${matchedKind === "bill" ? "a bill" : "an invoice"} payment. Remove the payment on the ${matchedKind} to ${action}.`;
}

export function isPaymentLinkKind(matchedKind: unknown): matchedKind is "bill" | "invoice" {
  return matchedKind === "bill" || matchedKind === "invoice";
}

export const PERIOD_STATUSES = ["in_progress", "completed", "auto_reconciled", "out_of_balance"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export type PeriodTransaction = {
  _id: string;
  accountId?: string | null;
  date: string;
  amountCents: number;
  reconciledAtISO?: string | null;
};

export type PeriodLike = {
  _id: string;
  accountId: string;
  startDate: string;
  endDate: string;
  openingBalanceCents?: number | null;
  endingBalanceCents: number;
  status: string;
  clearedFingerprint?: string | null;
  createdAtISO?: string;
};

export function isCleared(txn: Pick<PeriodTransaction, "reconciledAtISO">): boolean {
  return Boolean(txn.reconciledAtISO);
}

export function transactionsInPeriod<T extends PeriodTransaction>(
  transactions: readonly T[],
  period: Pick<PeriodLike, "accountId" | "startDate" | "endDate">,
): T[] {
  return transactions
    .filter((txn) => String(txn.accountId ?? "") === String(period.accountId) && txn.date >= period.startDate && txn.date <= period.endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a._id).localeCompare(String(b._id)));
}

export type PeriodSummary = {
  beginningBalanceCents: number;
  endingBalanceCents: number;
  clearedDepositsCents: number;
  /** Positive number: total of cleared money-out lines. */
  clearedPaymentsCents: number;
  clearedBalanceCents: number;
  differenceCents: number;
  clearedCount: number;
  unclearedCount: number;
  transactionCount: number;
};

export function summarizePeriod(
  beginningBalanceCents: number,
  endingBalanceCents: number,
  transactions: readonly PeriodTransaction[],
): PeriodSummary {
  let deposits = 0;
  let payments = 0;
  let cleared = 0;
  for (const txn of transactions) {
    if (!isCleared(txn)) continue;
    cleared += 1;
    if (txn.amountCents >= 0) deposits += txn.amountCents;
    else payments += -txn.amountCents;
  }
  const clearedBalanceCents = beginningBalanceCents + deposits - payments;
  return {
    beginningBalanceCents,
    endingBalanceCents,
    clearedDepositsCents: deposits,
    clearedPaymentsCents: payments,
    clearedBalanceCents,
    differenceCents: endingBalanceCents - clearedBalanceCents,
    clearedCount: cleared,
    unclearedCount: transactions.length - cleared,
    transactionCount: transactions.length,
  };
}

/** FNV-1a over a canonical listing; small, deterministic and runtime-neutral. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function periodFingerprint(
  beginningBalanceCents: number,
  endingBalanceCents: number,
  transactions: readonly PeriodTransaction[],
): string {
  const lines = [...transactions]
    .map((txn) => `${txn._id}|${txn.date}|${txn.amountCents}|${isCleared(txn) ? 1 : 0}`)
    .sort();
  const canonical = `${beginningBalanceCents};${endingBalanceCents};${lines.join(";")}`;
  return `${transactions.length}-${fnv1a(canonical)}`;
}

/** Periods of one account in statement order. */
export function orderPeriods<T extends Pick<PeriodLike, "endDate" | "startDate" | "_id">>(periods: readonly T[]): T[] {
  return [...periods].sort((a, b) => a.endDate.localeCompare(b.endDate) || a.startDate.localeCompare(b.startDate) || String(a._id).localeCompare(String(b._id)));
}

/** The first period starts at its stored opening balance; each later period
 * begins at the previous statement's ending balance. */
export function beginningBalanceFor(ordered: readonly PeriodLike[], index: number): number {
  if (index <= 0) return Math.round(ordered[0]?.openingBalanceCents ?? 0);
  return ordered[index - 1].endingBalanceCents;
}

export function isClosedStatus(status: string): boolean {
  return status === "completed" || status === "auto_reconciled" || status === "out_of_balance";
}

/**
 * The status to show. Closed periods whose transactions no longer match the
 * completion snapshot read `out_of_balance`; once the lines match again the
 * period returns to its closed status.
 */
export function effectivePeriodStatus(period: Pick<PeriodLike, "status" | "clearedFingerprint">, currentFingerprint: string): PeriodStatus {
  if (period.status === "in_progress") return "in_progress";
  if (period.clearedFingerprint && period.clearedFingerprint !== currentFingerprint) return "out_of_balance";
  if (period.status === "out_of_balance") return period.clearedFingerprint ? "completed" : "out_of_balance";
  return period.status === "auto_reconciled" ? "auto_reconciled" : "completed";
}

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  in_progress: "In progress",
  completed: "Completed",
  auto_reconciled: "Auto-reconciled",
  out_of_balance: "Balances no longer match",
};
