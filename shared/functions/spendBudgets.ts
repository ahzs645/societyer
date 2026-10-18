/**
 * PORTABLE FUNCTIONS: committee spend budgets.
 *
 * A spend budget caps what a committee and/or named people may spend per
 * cycle (weekly, monthly, quarterly) or once. "% spent" comes from spend
 * entries (shared/spendBudgets.ts); `loadSpendSources` is the one place that
 * decides which records count: expense claims and money-out bank
 * transactions assigned to a budget (a claim's matched payout line is not
 * counted twice; see shared/spendBudgets.ts). Each handler runs unchanged on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { todayDateOnly } from "../dateOnly";
import {
  SPEND_BUDGET_CYCLE_LABELS,
  SPEND_BUDGET_STATUS_LABELS,
  budgetSpend,
  claimBudgetImpact,
  claimSpendEntries,
  cycleWindow,
  isClaimPayoutOnBudget,
  isAssignedToBudget,
  spendBudgetStatus,
  transactionSpendEntries,
  validateSpendBudget,
  type ClaimForSpend,
  type CommitteeMemberLike,
  type SpendBudgetCycle,
  type SpendBudgetLike,
  type SpendSource,
  type TransactionForSpend,
  type UserLike,
} from "../spendBudgets";

export type SpendBudgetRow = PortableDoc & SpendBudgetLike & {
  societyId: string;
  name: string;
  currency: string;
  notes?: string;
  createdAtISO: string;
};

type ClaimRow = PortableDoc & ClaimForSpend & { title: string; claimantName: string; claimantUserId?: string; claimType?: string };
type MemberRow = PortableDoc & CommitteeMemberLike;
type TransactionRow = PortableDoc & TransactionForSpend & { societyId: string; description?: string; counterparty?: string };
type UserRow = PortableDoc & UserLike;

/**
 * Where spend comes from: claims and money-out bank transactions assigned to
 * a budget. Add a source here (card spend) and every budget figure picks it up.
 */
export async function loadSpendSources(ctx: PortableQueryCtx, societyId: string): Promise<{ sources: SpendSource[]; claims: ClaimRow[]; transactions: TransactionRow[] }> {
  const [claims, allTransactions] = await Promise.all([
    ctx.db.query<ClaimRow>("expenseReports").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<TransactionRow>("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const claimEntries = claimSpendEntries(claims);
  const transactionEntries = transactionSpendEntries(allTransactions, claims);
  const counted = new Set(transactionEntries.map((entry) => entry.sourceId));
  return { sources: [() => claimEntries, () => transactionEntries], claims, transactions: allTransactions.filter((txn) => counted.has(String(txn._id))) };
}

/**
 * Checks a budget for a bank transaction before it is assigned: the budget
 * belongs to this organization, is not archived and is active on the
 * transaction's date; the transaction is money out and is not the payout of
 * a claim already charged to that budget. Returns the budget.
 */
export async function requireBudgetForTransaction(ctx: PortableQueryCtx, societyId: string, budgetId: string, txn: Pick<TransactionRow, "amountCents" | "date" | "matchedKind" | "matchedId">) {
  const budget = await getOwned<SpendBudgetRow>(ctx, "spendBudgets", budgetId, societyId);
  if (budget.archivedAtISO) throw new Error("That spend budget is archived.");
  if (!(Number(txn.amountCents) < 0)) throw new Error("Only money-out transactions count against a spend budget.");
  const on = String(txn.date).slice(0, 10);
  if (budget.startDate > on || (budget.endDate && budget.endDate < on)) throw new Error(`“${budget.name}” isn't active on the date of this transaction.`);
  if (txn.matchedKind && txn.matchedId) {
    const claims = await ctx.db.query<ClaimRow>("expenseReports").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    const claimBudget = new Map(claims.map((claim) => [String(claim._id), String(claim.spendBudgetId ?? "")]));
    if (isClaimPayoutOnBudget(txn, claimBudget, budgetId)) throw new Error(`This transaction pays a claim already charged to “${budget.name}”, so it would count twice.`);
  }
  return budget;
}

async function loadPeople(ctx: PortableQueryCtx, societyId: string) {
  const [users, members, committees] = await Promise.all([
    ctx.db.query<UserRow>("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<MemberRow>("committeeMembers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("committees").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return { users, members, committees };
}

const userName = (user: UserLike) => String(user.displayName ?? user.name ?? user.email ?? "Member");

/** Every spend budget with its status, the current cycle's spend, who it's for, and a summary. */
export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const viewer = await requireSocietyMembership(ctx, societyId);
  const today = todayDateOnly();
  const [budgets, { sources, claims, transactions }, people] = await Promise.all([
    ctx.db.query<SpendBudgetRow>("spendBudgets").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    loadSpendSources(ctx, societyId),
    loadPeople(ctx, societyId),
  ]);
  const userById = new Map(people.users.map((row) => [String(row._id), row]));
  const committeeById = new Map(people.committees.map((row) => [String(row._id), row]));
  const rows = budgets.map((budget) => {
    const status = spendBudgetStatus(budget, today);
    const spend = budgetSpend(budget, sources, today);
    const windowClaims = claims
      .filter((claim) => String(claim.spendBudgetId ?? "") === String(budget._id))
      .filter((claim) => String(claim.incurredAtISO).slice(0, 10) >= spend.window.start && String(claim.incurredAtISO).slice(0, 10) <= spend.window.end)
      .sort((a, b) => String(b.incurredAtISO).localeCompare(String(a.incurredAtISO)))
      .map((claim) => ({ _id: String(claim._id), title: claim.title, claimantName: claim.claimantName, amountCents: claim.amountCents, status: claim.status, incurredAtISO: claim.incurredAtISO, claimType: claim.claimType }));
    const windowTransactions = transactions
      .filter((txn) => String(txn.spendBudgetId ?? "") === String(budget._id))
      .filter((txn) => String(txn.date).slice(0, 10) >= spend.window.start && String(txn.date).slice(0, 10) <= spend.window.end)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((txn) => ({ _id: String(txn._id), date: String(txn.date), description: String(txn.counterparty || txn.description || "Bank transaction"), amountCents: Math.abs(Number(txn.amountCents) || 0) }));
    const committee = budget.committeeId ? committeeById.get(String(budget.committeeId)) : undefined;
    return {
      _id: String(budget._id),
      name: budget.name,
      limitCents: budget.limitCents,
      currency: budget.currency ?? "CAD",
      cycle: budget.cycle as SpendBudgetCycle,
      cycleLabel: SPEND_BUDGET_CYCLE_LABELS[budget.cycle as SpendBudgetCycle] ?? budget.cycle,
      startDate: budget.startDate,
      endDate: budget.endDate,
      status,
      statusLabel: SPEND_BUDGET_STATUS_LABELS[status],
      archived: Boolean(budget.archivedAtISO),
      committeeId: budget.committeeId ? String(budget.committeeId) : undefined,
      committeeName: committee ? String(committee.name) : undefined,
      memberUserIds: (budget.memberUserIds ?? []).map(String),
      memberNames: (budget.memberUserIds ?? []).map((id) => userById.get(String(id))).filter((user): user is UserRow => Boolean(user)).map(userName),
      notes: budget.notes,
      spend,
      claims: windowClaims,
      transactions: windowTransactions,
      canCharge: status !== "ended" && isAssignedToBudget(budget, userById.get(String(viewer._id)) ?? null, people.members, today),
    };
  });
  rows.sort((a, b) => Number(a.archived) - Number(b.archived) || ["active", "upcoming", "ended"].indexOf(a.status) - ["active", "upcoming", "ended"].indexOf(b.status) || a.name.localeCompare(b.name));
  const active = rows.filter((row) => row.status === "active" && !row.archived);
  return {
    rows,
    summary: {
      activeCount: active.length,
      upcomingCount: rows.filter((row) => row.status === "upcoming" && !row.archived).length,
      limitCents: active.reduce((sum, row) => sum + row.limitCents, 0),
      spentCents: active.reduce((sum, row) => sum + row.spend.spentCents, 0),
      remainingCents: active.reduce((sum, row) => sum + Math.max(0, row.spend.remainingCents), 0),
      overLimitCount: active.filter((row) => row.spend.overLimit).length,
    },
    committees: people.committees.map((row) => ({ _id: String(row._id), name: String(row.name) })),
    users: people.users.filter((user) => !user.status || user.status === "Active").map((user) => ({ _id: String(user._id), name: userName(user) })),
  };
}

/**
 * Budgets a claimant may charge a claim to, each with what is left in the
 * cycle containing the claim's date and whether this claim would go over.
 */
export async function optionsForClaimPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; claimantUserId?: string; incurredAtISO?: string; amountCents?: number; claimId?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const today = todayDateOnly();
  const on = args.incurredAtISO && /^\d{4}-\d{2}-\d{2}/.test(args.incurredAtISO) ? args.incurredAtISO.slice(0, 10) : today;
  const [budgets, { sources, claims }, people] = await Promise.all([
    ctx.db.query<SpendBudgetRow>("spendBudgets").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
    loadSpendSources(ctx, args.societyId),
    loadPeople(ctx, args.societyId),
  ]);
  const claimant = args.claimantUserId ? people.users.find((user) => String(user._id) === String(args.claimantUserId)) ?? null : null;
  const current = args.claimId ? claims.find((claim) => String(claim._id) === String(args.claimId)) : undefined;
  return budgets
    .filter((budget) => !budget.archivedAtISO && spendBudgetStatus(budget, on) !== "ended" && budget.startDate <= on)
    .filter((budget) => isAssignedToBudget(budget, claimant, people.members, today))
    .map((budget) => {
      const window = cycleWindow(budget, on);
      const spend = budgetSpend({ ...budget, startDate: window.start, endDate: window.end, cycle: "once" }, sources, window.start);
      // The claim being edited already counts if it is assigned here and in this window.
      const counted = current && String(current.spendBudgetId ?? "") === String(budget._id) && claimSpendEntries([current]).some((entry) => entry.date >= window.start && entry.date <= window.end)
        ? Math.abs(current.amountCents)
        : 0;
      const impact = claimBudgetImpact(spend, args.amountCents ?? 0, counted);
      return {
        _id: String(budget._id),
        name: budget.name,
        cycleLabel: SPEND_BUDGET_CYCLE_LABELS[budget.cycle as SpendBudgetCycle] ?? budget.cycle,
        limitCents: budget.limitCents,
        window,
        spentCents: spend.spentCents - counted,
        remainingCents: spend.remainingCents + counted,
        remainingAfterCents: impact.remainingAfterCents,
        exceeds: impact.exceeds,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Throws unless the claimant may charge this budget. Used when a claim is saved. */
export async function requireBudgetForClaimant(ctx: PortableQueryCtx, societyId: string, budgetId: string, claimantUserId: string | undefined, incurredAtISO: string) {
  const budget = await getOwned<SpendBudgetRow>(ctx, "spendBudgets", budgetId, societyId);
  if (budget.archivedAtISO) throw new Error("That spend budget is archived.");
  const on = String(incurredAtISO).slice(0, 10);
  if (budget.startDate > on || (budget.endDate && budget.endDate < on)) throw new Error(`“${budget.name}” isn't active on the date of this expense.`);
  if (!claimantUserId) throw new Error("Link the claimant to a user before charging a spend budget.");
  const people = await loadPeople(ctx, societyId);
  const claimant = people.users.find((user) => String(user._id) === String(claimantUserId)) ?? null;
  if (!isAssignedToBudget(budget, claimant, people.members, todayDateOnly())) throw new Error(`The claimant isn't assigned to “${budget.name}”.`);
  return budget;
}

/** Create or edit a spend budget. */
export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: { id?: string; societyId: string; name: string; limitCents: number; cycle: string; startDate: string; endDate?: string; committeeId?: string; memberUserIds?: string[]; notes?: string },
) {
  const user = await requirePermissionPortable(ctx, args.societyId, "financials:write");
  const memberUserIds = [...new Set((args.memberUserIds ?? []).map(String))];
  // Ownership first, so a foreign id reads as not found rather than as a validation error.
  await Promise.all([
    args.id ? getOwned(ctx, "spendBudgets", args.id, args.societyId) : Promise.resolve(),
    args.committeeId ? getOwned(ctx, "committees", args.committeeId, args.societyId) : Promise.resolve(),
    ...memberUserIds.map((id) => getOwned(ctx, "users", id, args.societyId)),
  ]);
  const errors = validateSpendBudget({ ...args, memberUserIds });
  if (errors.length) throw new Error(errors[0]);
  const nowISO = new Date().toISOString();
  const payload = {
    name: args.name.trim(),
    limitCents: args.limitCents,
    cycle: args.cycle,
    startDate: args.startDate,
    endDate: args.endDate || undefined,
    committeeId: args.committeeId || undefined,
    memberUserIds,
    notes: args.notes?.trim() || undefined,
    updatedAtISO: nowISO,
  };
  if (args.id) {
    await ctx.db.patch(args.id, payload);
    return args.id;
  }
  const userId = String(user._id);
  return ctx.db.insert("spendBudgets", {
    societyId: args.societyId,
    currency: "CAD",
    ...payload,
    ...(userId.startsWith("local-workspace-owner:") ? {} : { createdByUserId: userId }),
    createdAtISO: nowISO,
  });
}

/** Archive (no new claims; history kept) or restore a budget. */
export async function setArchivedPortable(ctx: PortableMutationCtx, { id, archived }: { id: string; archived: boolean }) {
  const budget = await requireOwnedRow<SpendBudgetRow>(ctx, "spendBudgets", id);
  await requirePermissionPortable(ctx, budget.societyId, "financials:write");
  await ctx.db.patch(id, { archivedAtISO: archived ? new Date().toISOString() : undefined, updatedAtISO: new Date().toISOString() });
  return id;
}

/** Delete a budget no claim or bank transaction uses; otherwise archive it instead. */
export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const budget = await requireOwnedRow<SpendBudgetRow>(ctx, "spendBudgets", id);
  await requirePermissionPortable(ctx, budget.societyId, "financials:write");
  const claims = await ctx.db.query<ClaimRow>("expenseReports").withIndex("by_society", (q) => q.eq("societyId", budget.societyId)).collect();
  if (claims.some((claim) => String(claim.spendBudgetId ?? "") === String(id))) {
    throw new Error("Claims are charged to this budget. Archive it instead so their history stays.");
  }
  const transactions = await ctx.db.query<TransactionRow>("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", budget.societyId)).collect();
  if (transactions.some((txn) => String(txn.spendBudgetId ?? "") === String(id))) {
    throw new Error("Bank transactions are charged to this budget. Archive it instead so their history stays.");
  }
  await ctx.db.delete(id);
}
