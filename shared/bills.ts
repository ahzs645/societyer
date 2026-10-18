/**
 * Bills (accounts payable): pure helpers shared by the portable handlers
 * (shared/functions/bills.ts), the Bills pages and the gate.
 *
 * A bill stores its lifecycle (draft | awaiting_approval | approved |
 * scheduled | canceled) and its payments; open, partially paid, paid and
 * overdue are derived from the balance and the due date against the
 * organisation's local today, as invoices are (shared/invoicing.ts).
 *
 * Ledger shape (docs/accounting-shape.md, "Accounting basis"): approving
 * posts Dr each line's account / Cr Accounts payable as an accrual-only entry;
 * each payment posts Dr Accounts payable / Cr the account it was paid from
 * (both bases) plus a cash-only entry repeating the paid share of the expense
 * lines (Dr expense / Cr Accounts payable) on the payment date; cancelling an
 * approved bill posts the mirror of the approval entry (accrual-only too).
 *
 * Money is always integer cents. Dates are `YYYY-MM-DD` calendar dates.
 * Pure TypeScript: no Convex, DOM or Node imports.
 */
import { addDays, daysBetween, dueDateForTerms, INVOICE_TERMS, INVOICE_TERMS_LABEL, isCalendarDate } from "./invoicing";
import { lineTagProblems } from "./transactionLines";

export { addDays, daysBetween, dueDateForTerms, isCalendarDate };

export const BILL_TERMS = INVOICE_TERMS;
export type BillTerms = (typeof BILL_TERMS)[number];
export const BILL_TERMS_LABEL = INVOICE_TERMS_LABEL;
export const DEFAULT_BILL_TERMS: BillTerms = "net_30";

/** What is stored. Open, partially paid, paid and overdue are derived. */
export const BILL_LIFECYCLES = ["draft", "awaiting_approval", "approved", "scheduled", "canceled"] as const;
export type BillLifecycle = (typeof BILL_LIFECYCLES)[number];

export const BILL_STATUSES = ["draft", "awaiting_approval", "open", "scheduled", "partially_paid", "paid", "overdue", "canceled"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Needs approval",
  open: "Open",
  scheduled: "Scheduled",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  canceled: "Canceled",
};

export const BILL_PAYMENT_METHODS = ["eft", "e_transfer", "cheque", "pre_authorized_debit", "card", "cash", "other"] as const;
export type BillPaymentMethod = (typeof BILL_PAYMENT_METHODS)[number];
export const BILL_PAYMENT_METHOD_LABEL: Record<BillPaymentMethod, string> = {
  eft: "EFT / online banking",
  e_transfer: "Interac e-Transfer",
  cheque: "Cheque",
  pre_authorized_debit: "Pre-authorized debit",
  card: "Credit card",
  cash: "Cash",
  other: "Other",
};

export function isBillPaymentMethod(value: unknown): value is BillPaymentMethod {
  return BILL_PAYMENT_METHODS.includes(value as BillPaymentMethod);
}

/**
 * One line of a bill: where the cost goes in the books. New per-line
 * attributes (tags, program codes) are added here as optional fields.
 */
export type BillLine = {
  key: string;
  accountId?: string;
  amountCents: number;
  memo?: string;
  fundRestrictionId?: string;
  /** Reporting tags, at most one per tag group (the transaction-line rule). */
  tagIds?: string[];
};

/** The paid share of one bill line recognised by a payment's cash-only entry. */
export type BillCashShare = { key: string; amountCents: number };

export type BillPayment = {
  key: string;
  date: string;
  amountCents: number;
  method: string;
  reference?: string;
  financialTransactionId?: string;
  cashAccountId?: string;
  journalEntryId?: string;
  /** The cash-only entry recognising the paid share of the expense lines. */
  cashBasisJournalEntryId?: string;
  cashBasisShares?: BillCashShare[];
};

export function billTotalCents(lines: ReadonlyArray<Pick<BillLine, "amountCents">> | undefined): number {
  return (lines ?? []).reduce((sum, line) => sum + Math.round(Number(line.amountCents) || 0), 0);
}

export function billPaidCents(payments: ReadonlyArray<Pick<BillPayment, "amountCents">> | undefined): number {
  return (payments ?? []).reduce((sum, payment) => sum + Math.round(Number(payment.amountCents) || 0), 0);
}

export type BillStatusInput = {
  lifecycle: BillLifecycle | string;
  dueDate: string;
  totalCents: number;
  payments?: ReadonlyArray<Pick<BillPayment, "amountCents">>;
};

/**
 * The status a person sees. `today` must be the organisation's local calendar
 * date: a bill due today is not overdue until tomorrow. Overdue wins over
 * partially paid and scheduled (the money is late either way).
 */
export function deriveBillStatus(bill: BillStatusInput, today: string): BillStatus {
  if (bill.lifecycle === "canceled") return "canceled";
  if (bill.lifecycle === "draft") return "draft";
  if (bill.lifecycle === "awaiting_approval") return "awaiting_approval";
  const paid = billPaidCents(bill.payments);
  if (bill.totalCents - paid <= 0) return "paid";
  if (bill.dueDate < today) return "overdue";
  if (paid > 0) return "partially_paid";
  if (bill.lifecycle === "scheduled") return "scheduled";
  return "open";
}

/** Approved, unpaid or partly paid: money the organization still owes. */
export function isOutstandingStatus(status: BillStatus): boolean {
  return status === "open" || status === "scheduled" || status === "partially_paid" || status === "overdue";
}

/** Bills that can take a payment (approved and not settled). */
export function canPayStatus(status: BillStatus): boolean {
  return isOutstandingStatus(status);
}

export function daysPastDue(dueDate: string, today: string): number {
  return Math.max(0, daysBetween(dueDate, today));
}

export const DUE_SOON_DAYS = 7;

/** Outstanding, not overdue, and due within the next seven days (today included). */
export function isDueSoon(bill: { status: BillStatus; dueDate: string }, today: string): boolean {
  if (!isOutstandingStatus(bill.status) || bill.status === "overdue") return false;
  return bill.dueDate >= today && bill.dueDate <= addDays(today, DUE_SOON_DAYS);
}

/* ------------------------------------------------------------- validation */

/**
 * Problems with the lines; `complete` also requires an account on every line
 * (submitting, approving). With `groupOf` (tag id → group id) tags are checked
 * as on transaction lines: known tags, at most one per group.
 */
export function validateBillLines(
  lines: ReadonlyArray<BillLine>,
  { complete, groupOf }: { complete: boolean; groupOf?: (tagId: string) => string | undefined },
): string | null {
  if (lines.length > 100) return "A bill can have at most 100 lines.";
  for (const [index, line] of lines.entries()) {
    const n = index + 1;
    if (!Number.isSafeInteger(line.amountCents)) return `Line ${n}: enter an amount.`;
    if (line.amountCents < 0) return `Line ${n}: amounts can't be negative. Record a vendor credit as its own bill line on the right account.`;
    if (complete && !line.accountId) return `Line ${n}: choose the account this cost goes to.`;
    const tagProblem = groupOf ? lineTagProblems(`Line ${n}`, line.tagIds, groupOf)[0] : undefined;
    if (tagProblem) return tagProblem;
  }
  if (complete) {
    if (!lines.length) return "Add at least one line.";
    if (billTotalCents(lines) <= 0) return "The bill total must be above zero.";
  }
  return null;
}

/** What a bill still needs before it can go for approval, or null when it's ready. */
export function billSubmitProblem(bill: {
  vendorId?: string | null;
  billDate?: string | null;
  dueDate?: string | null;
  lines: ReadonlyArray<BillLine>;
}): string | null {
  if (!bill.vendorId) return "Choose the vendor.";
  if (!isCalendarDate(bill.billDate)) return "Choose the bill date.";
  if (!isCalendarDate(bill.dueDate)) return "Choose the due date.";
  if (bill.dueDate < bill.billDate) return "The due date can't be before the bill date.";
  return validateBillLines(bill.lines, { complete: true });
}

/* ------------------------------------------------------------ duplicates */

export function normalizeBillNumber(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ""));
}

export type DuplicateCandidate = {
  _id: string;
  vendorId?: string | null;
  billNumber?: string | null;
  lifecycle?: string;
};

/**
 * Another live bill from the same vendor with the same bill number
 * ("INV-0042", "inv 42" and "0042" are one number). Canceled bills don't count.
 */
export function findDuplicateBill<T extends DuplicateCandidate>(
  bill: { _id?: string | null; vendorId?: string | null; billNumber?: string | null },
  others: ReadonlyArray<T>,
): T | null {
  const number = normalizeBillNumber(bill.billNumber);
  if (!bill.vendorId || !number) return null;
  return (
    others.find((other) =>
      other._id !== bill._id &&
      other.lifecycle !== "canceled" &&
      other.vendorId === bill.vendorId &&
      normalizeBillNumber(other.billNumber) === number) ?? null
  );
}

/* --------------------------------------------------------------- posting */

export type PostingLine = {
  accountId: string;
  side: "debit" | "credit";
  amountCents: number;
  description?: string;
  fundRestrictionId?: string;
  financialTransactionId?: string;
  tagIds?: string[];
};

function billPostingLabel(bill: { billNumber?: string | null; vendorName?: string | null }) {
  return [bill.vendorName, bill.billNumber ? `bill ${bill.billNumber}` : null].filter(Boolean).join(" ");
}

function lineDimensions(line: Pick<BillLine, "fundRestrictionId" | "tagIds">) {
  return {
    ...(line.fundRestrictionId ? { fundRestrictionId: line.fundRestrictionId } : {}),
    ...(line.tagIds?.length ? { tagIds: [...line.tagIds] } : {}),
  };
}

/**
 * Approval entry: one debit per line (lines on the same account and fund are
 * kept separate so memos survive) and one credit to Accounts payable for the
 * total. Zero-amount lines are left out.
 */
export function approvalPostingLines(
  bill: { lines: ReadonlyArray<BillLine>; billNumber?: string | null; vendorName?: string | null },
  payablesAccountId: string,
): PostingLine[] {
  const label = billPostingLabel(bill);
  const debits: PostingLine[] = bill.lines
    .filter((line) => line.amountCents > 0)
    .map((line) => {
      if (!line.accountId) throw new Error("Every line needs an account before the bill can be posted.");
      return {
        accountId: line.accountId,
        side: "debit",
        amountCents: line.amountCents,
        description: line.memo || label || "Bill",
        ...lineDimensions(line),
      };
    });
  const total = debits.reduce((sum, line) => sum + line.amountCents, 0);
  if (total <= 0) throw new Error("The bill total must be above zero.");
  return [...debits, { accountId: payablesAccountId, side: "credit", amountCents: total, description: label ? `Accounts payable: ${label}` : "Accounts payable" }];
}

/** Payment entry: Dr Accounts payable / Cr the bank or card account it was paid from. */
export function paymentPostingLines(
  payment: { amountCents: number; financialTransactionId?: string | null; reference?: string | null },
  payablesAccountId: string,
  cashAccountId: string,
  label = "Bill payment",
): PostingLine[] {
  if (!(payment.amountCents > 0)) throw new Error("A payment must be above zero.");
  const link = payment.financialTransactionId ? { financialTransactionId: payment.financialTransactionId } : {};
  const description = payment.reference ? `${label} (${payment.reference})` : label;
  return [
    { accountId: payablesAccountId, side: "debit", amountCents: payment.amountCents, description, ...link },
    { accountId: cashAccountId, side: "credit", amountCents: payment.amountCents, description, ...link },
  ];
}

/**
 * What earlier payments already recognised on each line under cash basis:
 * their stored shares, or (for payments recorded before shares were stored)
 * the shares the same allocation gives them in order.
 */
export function recognizedCashShares(
  lines: ReadonlyArray<Pick<BillLine, "key" | "amountCents">>,
  payments: ReadonlyArray<Pick<BillPayment, "amountCents" | "cashBasisShares">>,
): Map<string, number> {
  const recognized = new Map<string, number>();
  for (const payment of payments) {
    const shares = payment.cashBasisShares ?? cashBasisShares(lines, recognized, payment.amountCents);
    for (const share of shares) recognized.set(share.key, (recognized.get(share.key) ?? 0) + share.amountCents);
  }
  return recognized;
}

/**
 * The paid share of each line for a payment of `amountCents`, given what
 * earlier payments recognised: proportional to what each line still has
 * unrecognised, whole cents (largest remainders take the leftover cents,
 * earlier lines first on a tie). Shares never exceed a line's unrecognised
 * amount, always add up to the payment, and the payment that settles the
 * bill recognises exactly what is left, so a fully paid bill recognises every
 * line in full. Zero shares are left out.
 */
export function cashBasisShares(
  lines: ReadonlyArray<Pick<BillLine, "key" | "amountCents">>,
  recognized: ReadonlyMap<string, number>,
  amountCents: number,
): BillCashShare[] {
  const open = lines
    .filter((line) => line.amountCents > 0)
    .map((line) => ({ key: line.key, remaining: Math.max(0, line.amountCents - (recognized.get(line.key) ?? 0)) }))
    .filter((line) => line.remaining > 0);
  const remainingTotal = open.reduce((sum, line) => sum + line.remaining, 0);
  const amount = Math.min(Math.max(0, Math.round(amountCents)), remainingTotal);
  if (amount <= 0) return [];
  const shares = open.map((line, index) => {
    const exact = (line.remaining * amount) / remainingTotal;
    const whole = Math.floor(exact);
    return { key: line.key, index, remaining: line.remaining, amountCents: whole, fraction: exact - whole };
  });
  let leftover = amount - shares.reduce((sum, share) => sum + share.amountCents, 0);
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (leftover <= 0) break;
    if (share.amountCents < share.remaining) {
      share.amountCents += 1;
      leftover -= 1;
    }
  }
  return shares.filter((share) => share.amountCents > 0).map((share) => ({ key: share.key, amountCents: share.amountCents }));
}

/**
 * Cash-only entry for a payment: the paid share of each expense line (Dr
 * the line's account, with its fund and tags) against one credit to Accounts
 * payable, so under cash basis the expense lands on the payment date and
 * Accounts payable nets to zero.
 */
export function cashBasisPostingLines(
  bill: { lines: ReadonlyArray<BillLine>; billNumber?: string | null; vendorName?: string | null },
  shares: ReadonlyArray<BillCashShare>,
  payablesAccountId: string,
): PostingLine[] {
  const label = billPostingLabel(bill);
  const byKey = new Map(bill.lines.map((line) => [line.key, line]));
  const debits: PostingLine[] = shares
    .filter((share) => share.amountCents > 0)
    .map((share) => {
      const line = byKey.get(share.key);
      if (!line?.accountId) throw new Error("Every line needs an account before the bill can be posted.");
      return {
        accountId: line.accountId,
        side: "debit",
        amountCents: share.amountCents,
        description: `Paid: ${line.memo || label || "Bill"}`,
        ...lineDimensions(line),
      };
    });
  const total = debits.reduce((sum, line) => sum + line.amountCents, 0);
  if (total <= 0) throw new Error("A payment must be above zero.");
  return [...debits, { accountId: payablesAccountId, side: "credit", amountCents: total, description: label ? `Accounts payable paid: ${label}` : "Accounts payable paid" }];
}

/** The mirror of an entry's lines (debits become credits), for a reversal. */
export function reversalLines<T extends { side: string }>(lines: ReadonlyArray<T>): Array<T & { side: "debit" | "credit" }> {
  return lines.map((line) => ({ ...line, side: line.side === "debit" ? "credit" : "debit" }));
}

/** Debits minus credits, and whether they balance. */
export function postingBalance(lines: ReadonlyArray<{ side: string; amountCents: number }>) {
  let debitCents = 0;
  let creditCents = 0;
  for (const line of lines) {
    if (line.side === "debit") debitCents += line.amountCents;
    else creditCents += line.amountCents;
  }
  return { debitCents, creditCents, balanced: debitCents === creditCents && debitCents > 0 };
}

/* ------------------------------------------------------ match suggestions */

export type BillCandidateTransaction = {
  _id: string;
  date: string;
  amountCents: number;
  description?: string;
  counterparty?: string;
};

export type ScoredBillTransaction<T extends BillCandidateTransaction> = T & {
  score: number;
  exact: boolean;
  reasons: string[];
};

/** Words of a vendor name worth matching ("Coastal Hydro Ltd." → coastal, hydro). */
export function vendorNameTokens(name: string | null | undefined): string[] {
  const stop = new Set(["the", "and", "inc", "ltd", "llc", "corp", "co", "society", "limited", "company"]);
  return String(name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 2 && !stop.has(part));
}

export const SUGGESTION_MIN_SCORE = 40;
/** Bank lines this many days before the bill date or after the due date are not considered. */
export const SUGGESTION_WINDOW_DAYS = { beforeBill: 7, afterDue: 45 } as const;

/**
 * Money-out bank lines that look like the payment of this bill, best first:
 * the amount (the balance scores highest, then the total, then within 2%),
 * how close the date is to the due date, and the vendor's name in the
 * description or payee. Lines outside the date window, money in, and lines
 * larger than the balance are never suggested.
 */
export function suggestBillPayments<T extends BillCandidateTransaction>(
  bill: { billDate: string; dueDate: string; totalCents: number; balanceCents: number; vendorName?: string | null },
  transactions: ReadonlyArray<T>,
  limit = 4,
): Array<ScoredBillTransaction<T>> {
  const tokens = vendorNameTokens(bill.vendorName);
  const earliest = addDays(bill.billDate, -SUGGESTION_WINDOW_DAYS.beforeBill);
  const latest = addDays(bill.dueDate, SUGGESTION_WINDOW_DAYS.afterDue);
  const scored: Array<ScoredBillTransaction<T>> = [];
  for (const txn of transactions) {
    if (!(txn.amountCents < 0) || txn.date < earliest || txn.date > latest) continue;
    const amount = -txn.amountCents;
    if (amount > bill.balanceCents) continue;
    const reasons: string[] = [];
    let score = 0;
    if (amount === bill.balanceCents) {
      score += 50;
      reasons.push(bill.balanceCents === bill.totalCents ? "Matches the bill total" : "Matches the balance");
    } else if (amount === bill.totalCents) {
      score += 40;
      reasons.push("Matches the bill total");
    } else if (bill.balanceCents - amount <= Math.max(100, Math.round(bill.balanceCents * 0.02))) {
      score += 25;
      reasons.push("Within 2% of the balance");
    } else {
      score += 5;
    }
    const distance = Math.abs(daysBetween(bill.dueDate, txn.date));
    const dateScore = Math.max(0, 20 - Math.floor(distance / 2));
    score += dateScore;
    if (distance <= 3) reasons.push("Paid around the due date");
    const haystack = `${txn.description ?? ""} ${txn.counterparty ?? ""}`.toLowerCase();
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (hits > 0) {
      score += hits === tokens.length ? 30 : 20;
      reasons.push("Payee matches the vendor");
    }
    if (score < SUGGESTION_MIN_SCORE) continue;
    scored.push({ ...txn, score, exact: amount === bill.balanceCents, reasons });
  }
  return scored.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, limit);
}

/* ------------------------------------------------------------ summaries */

export type BillForSummary = {
  status: BillStatus;
  dueDate: string;
  totalCents: number;
  balanceCents: number;
  payments?: ReadonlyArray<Pick<BillPayment, "amountCents" | "date">>;
};

export function summarizeBills(bills: ReadonlyArray<BillForSummary>, today: string) {
  const summary = {
    outstandingCents: 0,
    outstandingCount: 0,
    overdueCents: 0,
    overdueCount: 0,
    dueSoonCents: 0,
    dueSoonCount: 0,
    draftCount: 0,
    awaitingCount: 0,
    awaitingCents: 0,
    scheduledCount: 0,
    paidLast30Cents: 0,
  };
  const since = addDays(today, -30);
  for (const bill of bills) {
    if (isOutstandingStatus(bill.status)) {
      summary.outstandingCents += bill.balanceCents;
      summary.outstandingCount += 1;
    }
    if (bill.status === "overdue") {
      summary.overdueCents += bill.balanceCents;
      summary.overdueCount += 1;
    }
    if (isDueSoon(bill, today)) {
      summary.dueSoonCents += bill.balanceCents;
      summary.dueSoonCount += 1;
    }
    if (bill.status === "draft") summary.draftCount += 1;
    if (bill.status === "awaiting_approval") {
      summary.awaitingCount += 1;
      summary.awaitingCents += bill.totalCents;
    }
    if (bill.status === "scheduled") summary.scheduledCount += 1;
    if (bill.status !== "canceled") {
      for (const payment of bill.payments ?? []) {
        if (payment.date >= since && payment.date <= today) summary.paidLast30Cents += payment.amountCents;
      }
    }
  }
  return summary;
}

export const BILL_TABS = ["drafts", "approval", "open", "overdue", "paid", "all"] as const;
export type BillTab = (typeof BILL_TABS)[number];

export function billMatchesTab(status: BillStatus, tab: BillTab): boolean {
  switch (tab) {
    case "drafts": return status === "draft";
    case "approval": return status === "awaiting_approval";
    case "open": return status === "open" || status === "scheduled" || status === "partially_paid";
    case "overdue": return status === "overdue";
    case "paid": return status === "paid";
    default: return true;
  }
}

export type VendorBillLike = {
  vendorId?: string | null;
  status: BillStatus;
  totalCents: number;
  balanceCents: number;
  paidCents: number;
  billDate: string;
};

/** Per-vendor outstanding, overdue and paid totals (canceled bills and drafts excluded from money). */
export function vendorTotals(bills: ReadonlyArray<VendorBillLike>) {
  const byVendor = new Map<string, { billCount: number; outstandingCents: number; overdueCents: number; paidCents: number; lastBillDate?: string }>();
  for (const bill of bills) {
    if (!bill.vendorId) continue;
    const row = byVendor.get(bill.vendorId) ?? { billCount: 0, outstandingCents: 0, overdueCents: 0, paidCents: 0 };
    row.billCount += 1;
    if (isOutstandingStatus(bill.status)) row.outstandingCents += bill.balanceCents;
    if (bill.status === "overdue") row.overdueCents += bill.balanceCents;
    if (bill.status !== "canceled") row.paidCents += bill.paidCents;
    if (bill.status !== "canceled" && (!row.lastBillDate || bill.billDate > row.lastBillDate)) row.lastBillDate = bill.billDate;
    byVendor.set(bill.vendorId, row);
  }
  return byVendor;
}

/** Terms from a vendor's default, falling back to net 30. */
export function normalizeBillTerms(value: unknown): BillTerms {
  return BILL_TERMS.includes(value as BillTerms) ? (value as BillTerms) : DEFAULT_BILL_TERMS;
}
