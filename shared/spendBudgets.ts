/**
 * Spend budgets: a spending limit for a committee or named people that resets
 * each cycle (weekly, monthly, quarterly) or runs once over its active dates.
 * These are not the annual line budgets in `budgets` (budget vs actual); they
 * cap what a group may spend and show how much of the current cycle is used.
 *
 * Spend is computed from spend entries, so more sources can feed a budget:
 * expense claims assigned to the budget (`claimSpendEntries`) and money-out
 * bank transactions assigned to it (`transactionSpendEntries`), both passed
 * to `budgetSpend`.
 *
 * Double counting: a claim's reimbursement is not linked to the bank line
 * that paid it today, so nothing can tell a payout line from other spending.
 * The rule is that a bank line counts whenever it is money out and assigned
 * to a budget, except when it is matched to a claim (`matchedKind:
 * "expenseReport"`, `matchedId` the claim) that is itself charged to the same
 * budget: then the claim already counts and the line is its payout. Until
 * reconciliation can make that match, don't assign a reimbursement payout to
 * the budget its claim charges (assigning one that is matched is refused).
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */

export const SPEND_BUDGET_CYCLES = ["weekly", "monthly", "quarterly", "once"] as const;
export type SpendBudgetCycle = (typeof SPEND_BUDGET_CYCLES)[number];

export const SPEND_BUDGET_CYCLE_LABELS: Record<SpendBudgetCycle, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  once: "One time",
};

export type SpendBudgetStatus = "upcoming" | "active" | "ended";

export const SPEND_BUDGET_STATUS_LABELS: Record<SpendBudgetStatus, string> = {
  upcoming: "Upcoming",
  active: "Active",
  ended: "Ended",
};

export type SpendBudgetLike = {
  _id: string;
  limitCents: number;
  cycle: string;
  startDate: string;
  endDate?: string | null;
  committeeId?: string | null;
  memberUserIds?: readonly string[] | null;
  archivedAtISO?: string | null;
};

/** One amount that counts against a budget. `source` names where it came from. */
export type SpendEntry = {
  source: "claim" | "transaction";
  sourceId: string;
  budgetId: string;
  amountCents: number;
  /** YYYY-MM-DD the spending happened. */
  date: string;
};

/** A function that lists spend entries; budgets sum whatever their sources return. */
export type SpendSource = () => readonly SpendEntry[];

function utc(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
const iso = (date: Date) => date.toISOString().slice(0, 10);

export function spendBudgetStatus(budget: Pick<SpendBudgetLike, "startDate" | "endDate" | "archivedAtISO">, today: string): SpendBudgetStatus {
  if (budget.startDate > today) return "upcoming";
  if (budget.archivedAtISO || (budget.endDate && budget.endDate < today)) return "ended";
  return "active";
}

/**
 * The cycle window containing `on`: Monday–Sunday weeks, calendar months and
 * calendar quarters, clipped to the budget's active dates. A one-time budget's
 * window is its whole active period.
 */
export function cycleWindow(budget: Pick<SpendBudgetLike, "cycle" | "startDate" | "endDate">, on: string): { start: string; end: string } {
  const day = utc(on);
  let start: Date;
  let end: Date;
  if (budget.cycle === "weekly") {
    const offset = (day.getUTCDay() + 6) % 7; // Monday = 0
    start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - offset));
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6));
  } else if (budget.cycle === "monthly") {
    start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    end = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));
  } else if (budget.cycle === "quarterly") {
    const q = Math.floor(day.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(day.getUTCFullYear(), q, 1));
    end = new Date(Date.UTC(day.getUTCFullYear(), q + 3, 0));
  } else {
    return { start: budget.startDate, end: budget.endDate ?? "9999-12-31" };
  }
  const window = { start: iso(start), end: iso(end) };
  if (budget.startDate > window.start) window.start = budget.startDate;
  if (budget.endDate && budget.endDate < window.end) window.end = budget.endDate;
  return window;
}

/** The window to report on: the current cycle, the first cycle of an upcoming budget, the last of an ended one. */
export function reportingWindow(budget: SpendBudgetLike, today: string): { start: string; end: string } {
  const status = spendBudgetStatus(budget, today);
  const on = status === "upcoming" ? budget.startDate : status === "ended" && budget.endDate ? budget.endDate : today;
  return cycleWindow(budget, on);
}

export type BudgetSpend = {
  window: { start: string; end: string };
  spentCents: number;
  remainingCents: number;
  /** 0..∞; 100 means the limit is fully used. */
  percentSpent: number;
  overLimit: boolean;
  entryCount: number;
  bySource: Record<SpendEntry["source"], number>;
};

/** Spend for the budget's reporting window, from every source given. */
export function budgetSpend(budget: SpendBudgetLike, sources: readonly SpendSource[], today: string): BudgetSpend {
  const window = reportingWindow(budget, today);
  const bySource: BudgetSpend["bySource"] = { claim: 0, transaction: 0 };
  let spent = 0;
  let count = 0;
  for (const source of sources) {
    for (const entry of source()) {
      if (entry.budgetId !== budget._id) continue;
      if (entry.date < window.start || entry.date > window.end) continue;
      spent += entry.amountCents;
      bySource[entry.source] += entry.amountCents;
      count += 1;
    }
  }
  const limit = Math.max(0, budget.limitCents);
  return {
    window,
    spentCents: spent,
    remainingCents: limit - spent,
    percentSpent: limit > 0 ? Math.round((spent / limit) * 1000) / 10 : spent > 0 ? 100 : 0,
    overLimit: spent > limit,
    entryCount: count,
    bySource,
  };
}

/** Claim statuses that commit money: submitted, approved or paid. */
export const SPENDING_CLAIM_STATUSES: ReadonlySet<string> = new Set(["Submitted", "Approved", "Paid"]);

export type ClaimForSpend = {
  _id: string;
  spendBudgetId?: string | null;
  amountCents: number;
  incurredAtISO: string;
  status: string;
};

/** Expense claims assigned to a budget, as spend entries. Drafts, declined and recalled claims don't count. */
export function claimSpendEntries(claims: readonly ClaimForSpend[]): SpendEntry[] {
  return claims
    .filter((claim) => claim.spendBudgetId && SPENDING_CLAIM_STATUSES.has(claim.status))
    .map((claim) => ({
      source: "claim" as const,
      sourceId: String(claim._id),
      budgetId: String(claim.spendBudgetId),
      amountCents: Math.abs(Math.round(claim.amountCents || 0)),
      date: String(claim.incurredAtISO).slice(0, 10),
    }));
}

/** The kind a bank line matched to an expense claim's payout carries. */
export const CLAIM_PAYOUT_MATCH_KIND = "expenseReport";

export type TransactionForSpend = {
  _id: string;
  spendBudgetId?: string | null;
  amountCents: number;
  date: string;
  matchedKind?: string | null;
  matchedId?: string | null;
};

/**
 * Money-out bank transactions assigned to a budget, as spend entries. Money in
 * never counts, and a line matched to a claim charged to the same budget is
 * that claim's payout and is left out (the claim counts instead).
 */
export function transactionSpendEntries(transactions: readonly TransactionForSpend[], claims: readonly Pick<ClaimForSpend, "_id" | "spendBudgetId">[] = []): SpendEntry[] {
  const claimBudget = new Map(claims.map((claim) => [String(claim._id), String(claim.spendBudgetId ?? "")]));
  return transactions
    .filter((txn) => txn.spendBudgetId && Number(txn.amountCents) < 0)
    .filter((txn) => !isClaimPayoutOnBudget(txn, claimBudget))
    .map((txn) => ({
      source: "transaction" as const,
      sourceId: String(txn._id),
      budgetId: String(txn.spendBudgetId),
      amountCents: Math.abs(Math.round(Number(txn.amountCents) || 0)),
      date: String(txn.date).slice(0, 10),
    }));
}

/** Whether a bank line is the payout of a claim already charged to the budget it is assigned to. */
export function isClaimPayoutOnBudget(txn: Pick<TransactionForSpend, "spendBudgetId" | "matchedKind" | "matchedId">, claimBudget: ReadonlyMap<string, string>, budgetId = txn.spendBudgetId): boolean {
  if (txn.matchedKind !== CLAIM_PAYOUT_MATCH_KIND || !txn.matchedId || !budgetId) return false;
  return claimBudget.get(String(txn.matchedId)) === String(budgetId);
}

export type CommitteeMemberLike = { committeeId: string; name?: string | null; email?: string | null; joinedAt?: string | null; leftAt?: string | null };
export type UserLike = { _id: string; displayName?: string | null; name?: string | null; email?: string | null };

const norm = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();

/** Whether a user sits on a committee on `today` (joined by then, not yet left): a member with the same email, or else the same name. */
export function userOnCommittee(user: UserLike, committeeId: string, members: readonly CommitteeMemberLike[], today: string): boolean {
  const email = norm(user.email);
  const names = [norm(user.displayName), norm(user.name)].filter(Boolean);
  return members.some((member) =>
    String(member.committeeId) === String(committeeId) &&
    (!member.joinedAt || String(member.joinedAt).slice(0, 10) <= today) &&
    (!member.leftAt || member.leftAt > today) &&
    ((email && norm(member.email) === email) || (names.length > 0 && names.includes(norm(member.name)))));
}

/** Budgets a claimant may charge: assigned by name, or through their committee. */
export function isAssignedToBudget(
  budget: Pick<SpendBudgetLike, "committeeId" | "memberUserIds">,
  user: UserLike | null | undefined,
  members: readonly CommitteeMemberLike[],
  today: string,
): boolean {
  if (!user) return false;
  if ((budget.memberUserIds ?? []).some((id) => String(id) === String(user._id))) return true;
  return Boolean(budget.committeeId && userOnCommittee(user, String(budget.committeeId), members, today));
}

/** Problems with a budget before it is saved. */
export function validateSpendBudget(input: { name?: string; limitCents?: number; cycle?: string; startDate?: string; endDate?: string | null; committeeId?: string | null; memberUserIds?: readonly string[] | null }): string[] {
  const errors: string[] = [];
  if (!String(input.name ?? "").trim()) errors.push("Name the budget.");
  if (typeof input.limitCents !== "number" || !Number.isSafeInteger(input.limitCents) || input.limitCents <= 0 || input.limitCents > 100_000_000) {
    errors.push("Enter a spend limit between $0.01 and $1,000,000.");
  }
  if (!SPEND_BUDGET_CYCLES.includes(input.cycle as SpendBudgetCycle)) errors.push("Choose how often the limit resets.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate ?? ""))) errors.push("Enter the date the budget starts.");
  if (input.endDate && input.startDate && input.endDate < input.startDate) errors.push("The end date must be on or after the start date.");
  if (input.cycle === "once" && !input.endDate) errors.push("A one-time budget needs an end date.");
  if (!input.committeeId && !(input.memberUserIds ?? []).length) errors.push("Assign the budget to a committee or at least one person.");
  return errors;
}

/** What a claim of `amountCents` would leave in the budget, and whether it goes over. */
export function claimBudgetImpact(spend: Pick<BudgetSpend, "remainingCents">, amountCents: number, alreadyCountedCents = 0) {
  const remainingAfter = spend.remainingCents + alreadyCountedCents - Math.abs(amountCents);
  return { remainingAfterCents: remainingAfter, exceeds: remainingAfter < 0 };
}
