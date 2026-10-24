/**
 * PORTABLE FUNCTIONS: the bank-reconciliation domain
 * (overview / match / markManual / addManualTransaction / unmatch).
 *
 * A line a bill or invoice payment holds (`matchedKind` "bill" / "invoice")
 * is left to that payment: it can't be re-matched or unmatched here.
 *
 * Reads/writes financialTransactions (plus financialConnections /
 * financialAccounts for manual entry) over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireOwnedRow, requireSocietyMembership } from "./access";
import { addDaysToDateOnly, isDateOnly, todayDateOnly } from "../dateOnly";
import {
  beginningBalanceFor,
  effectivePeriodStatus,
  isClosedStatus,
  isPaymentLinkKind,
  orderPeriods,
  paymentLinkRefusal,
  periodFingerprint,
  summarizePeriod,
  transactionsInPeriod,
  type PeriodLike,
  type PeriodTransaction,
} from "../reconciliationPeriods";
import {
  autoReconcileReadiness,
  balanceBefore,
  monthBounds,
  monthStatusesForYear,
  withRunningBalance,
  type AutoReconcileReadiness,
} from "../reconciliationMonths";
import { bankAccountBalanceCents } from "../bankAccounts";
import { assertNativePayrollBankPatch } from "./payrollPaymentGuard";

/**
 * Returns every bank transaction with reconciliation status, plus a candidate
 * list of internal records (filings, donation receipts, employee payroll) that
 * could match each unreconciled line. Matching is heuristic — exact amount
 * within ±7 days for cash records, then string-similarity on counterparty.
 */
export async function overviewPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [txns, filings, receipts, employees] = await Promise.all([
    ctx.db
      .query("financialTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("filings")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("donationReceipts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("employees")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);

  const days = (a: string, b: string) =>
    Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;

  const enriched = txns.map((t: Record<string, any>) => {
    const candidates: { kind: string; id: string; label: string; score: number }[] = [];

    if (!t.reconciledAtISO) {
      // Filing fees — outflow, exact match on feePaidCents within 7 days of filedAt.
      for (const f of filings) {
        if (!f.feePaidCents || !f.filedAt) continue;
        if (Math.abs(t.amountCents) !== f.feePaidCents) continue;
        if (t.amountCents > 0) continue; // fees are outflows
        const d = days(t.date, f.filedAt);
        if (d > 7) continue;
        candidates.push({
          kind: "filing",
          id: f._id as unknown as string,
          label: `${f.kind} · ${f.confirmationNumber ?? "no conf #"}`,
          score: 100 - d * 5,
        });
      }
      // Donation receipts — inflow, exact amount within 14 days.
      for (const r of receipts) {
        if (t.amountCents !== r.amountCents) continue;
        if (t.amountCents < 0) continue;
        const d = days(t.date, r.receivedOnISO);
        if (d > 14) continue;
        let s = 100 - d * 3;
        if (t.counterparty && r.donorName && t.counterparty.toLowerCase().includes(r.donorName.toLowerCase().split(" ")[0])) {
          s += 30;
        }
        candidates.push({
          kind: "receipt",
          id: r._id as unknown as string,
          label: `Receipt #${r.receiptNumber} — ${r.donorName}`,
          score: s,
        });
      }
      // Payroll — outflow, name match against employee.
      if (t.amountCents < 0 && t.counterparty) {
        for (const e of employees) {
          const full = `${e.firstName} ${e.lastName}`.toLowerCase();
          if (
            t.counterparty.toLowerCase().includes(full) ||
            t.counterparty.toLowerCase().includes(e.lastName.toLowerCase())
          ) {
            candidates.push({
              kind: "payroll",
              id: e._id as unknown as string,
              label: `Payroll · ${e.firstName} ${e.lastName} (${e.role})`,
              score: 80,
            });
          }
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return { txn: t, candidates: candidates.slice(0, 3) };
  });

  const summary = {
    total: enriched.length,
    reconciled: enriched.filter((x: any) => x.txn.reconciledAtISO).length,
    withSuggestions: enriched.filter((x: any) => !x.txn.reconciledAtISO && x.candidates.length > 0).length,
    unmatched: enriched.filter((x: any) => !x.txn.reconciledAtISO && x.candidates.length === 0).length,
  };

  return { rows: enriched, summary };
}

export async function matchPortable(
  ctx: PortableMutationCtx,
  args: {
    txnId: string;
    matchedKind: string;
    matchedId: string;
    note?: string;
    actor?: string;
  },
) {
  const candidate = await ctx.db.get(args.txnId, "financialTransactions");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("financialTransactions not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "financialTransactions", args.txnId, candidate.societyId);
  const refusal = paymentLinkRefusal(candidate.matchedKind, "match it to something else");
  if (refusal) throw new Error(refusal);
  await assertNativePayrollBankPatch(ctx, candidate, { matchedKind: args.matchedKind, matchedId: args.matchedId });
  if (args.matchedKind === "payroll_remittance") throw new Error("Record a CRA settlement through the approved payroll remittance plan so the obligation, bank outflow and ledger are reconciled together.");
  if (args.matchedKind === "payroll") {
    const target = await ctx.db.get(args.matchedId, "payRuns");
    if (target?.calculationId && target.societyId === candidate.societyId) throw new Error("Record a finalized payroll bank payment from its saved payroll calculation so its method, amount and journal stay together.");
  }
  if (isPaymentLinkKind(args.matchedKind)) throw new Error(`Link a bank transaction to ${args.matchedKind === "bill" ? "a bill" : "an invoice"} by recording the payment on the ${args.matchedKind}.`);
  const principalId = await principalUserId(ctx, candidate.societyId);
  const principal = await getOwned(ctx, "users", principalId, candidate.societyId);
  const matchedTable = args.matchedKind === "filing"
    ? "filings"
    : args.matchedKind === "receipt"
      ? "donationReceipts"
      : args.matchedKind === "payroll"
        ? "employees"
        : null;
  if (matchedTable) await getOwned(ctx, matchedTable, args.matchedId, candidate.societyId);
  await ctx.db.patch(args.txnId, {
    reconciledAtISO: new Date().toISOString(),
    reconciledByName: String(principal.displayName ?? principal.name ?? "You"),
    matchedKind: args.matchedKind,
    matchedId: args.matchedId,
    reconciliationNote: args.note,
  });
  await flagChangedPeriods(ctx, candidate.accountId as string | undefined, candidate.date as string | undefined);
}

export async function markManualPortable(
  ctx: PortableMutationCtx,
  { txnId, note, actor }: { txnId: string; note: string; actor?: string },
) {
  const candidate = await ctx.db.get(txnId, "financialTransactions");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("financialTransactions not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "financialTransactions", txnId, candidate.societyId);
  const refusal = paymentLinkRefusal(candidate.matchedKind, "match it to something else");
  if (refusal) throw new Error(refusal);
  await assertNativePayrollBankPatch(ctx, candidate, { matchedKind: "manual", matchedId: "manual" });
  const principalId = await principalUserId(ctx, candidate.societyId);
  const principal = await getOwned(ctx, "users", principalId, candidate.societyId);
  await ctx.db.patch(txnId, {
    reconciledAtISO: new Date().toISOString(),
    reconciledByName: String(principal.displayName ?? principal.name ?? "You"),
    matchedKind: "manual",
    matchedId: "manual",
    reconciliationNote: note,
  });
  await flagChangedPeriods(ctx, candidate.accountId as string | undefined, candidate.date as string | undefined);
}

// Manually add a bank transaction so reconciliation is usable without a Wave/
// browser-connector sync. Ensures a "manual" connection + bank account exist
// (created once) so the financialTransactions row has the required references.
export async function addManualTransactionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    date: string;
    description: string;
    amountCents: number;
    counterparty?: string;
    category?: string;
    accountId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.accountId) await getOwned(ctx, "financialAccounts", args.accountId, args.societyId);
  const now = new Date().toISOString();
  const connections = await ctx.db
    .query("financialConnections")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  let connection: any = connections.find((c: Record<string, any>) => c.provider === "manual");
  if (!connection) {
    const connectionId = await ctx.db.insert("financialConnections", {
      societyId: args.societyId,
      provider: "manual",
      status: "connected",
      accountLabel: "Manual entries",
      syncMode: "manual",
      connectedAtISO: now,
      demo: false,
    });
    connection = await getOwned(ctx, "financialConnections", connectionId, args.societyId);
  }

  let accountId = args.accountId;
  if (!accountId) {
    const accounts = await ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const existing = accounts.find((a: Record<string, any>) => a.connectionId === connection!._id && a.accountType === "Bank");
    accountId = existing
      ? existing._id
      : await ctx.db.insert("financialAccounts", {
          societyId: args.societyId,
          connectionId: connection!._id,
          externalId: "manual-bank",
          name: "Manual bank account",
          currency: "CAD",
          accountType: "Bank",
          balanceCents: 0,
          isRestricted: false,
          sourceSystem: "csv",
        });
  }

  const id = await ctx.db.insert("financialTransactions", {
    societyId: args.societyId,
    connectionId: connection!._id,
    accountId,
    externalId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: args.date,
    description: args.description,
    amountCents: args.amountCents,
    counterparty: args.counterparty,
    category: args.category,
    ...(args.category ? { categorizedBy: "manual" } : {}),
  });
  await flagChangedPeriods(ctx, String(accountId), args.date);
  return id;
}

export async function unmatchPortable(ctx: PortableMutationCtx, { txnId }: { txnId: string }) {
  const candidate = await ctx.db.get(txnId, "financialTransactions");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("financialTransactions not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "financialTransactions", txnId, candidate.societyId);
  const refusal = paymentLinkRefusal(candidate.matchedKind, "unmatch it");
  if (refusal) throw new Error(refusal);
  await assertNativePayrollBankPatch(ctx, candidate, { matchedKind: undefined, matchedId: undefined });
  await ctx.db.patch(txnId, {
    reconciledAtISO: undefined,
    reconciledByName: undefined,
    matchedKind: undefined,
    matchedId: undefined,
    reconciliationNote: undefined,
  });
  await flagChangedPeriods(ctx, candidate.accountId as string | undefined, candidate.date as string | undefined);
}

/* ---------------------- statement reconciliation periods ---------------------- */

type PeriodRow = PeriodLike & {
  societyId: string;
  statementDocumentId?: string;
  completedAtISO?: string;
  completedByName?: string;
  outOfBalanceAtISO?: string;
  notes?: string;
  [key: string]: any;
};

const RECONCILABLE_ACCOUNT_TYPES = new Set(["bank", "credit", "cash"]);

async function accountPeriods(ctx: PortableQueryCtx, accountId: string): Promise<PeriodRow[]> {
  const rows = await ctx.db
    .query<PeriodRow>("reconciliationPeriods")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  return orderPeriods(rows);
}

async function accountTransactions(ctx: PortableQueryCtx, accountId: string): Promise<PeriodTransaction[]> {
  const rows = await ctx.db
    .query("financialTransactions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  return rows.map((row: any) => ({ ...row, _id: String(row._id), accountId: String(row.accountId) }));
}

function describePeriod(ordered: PeriodRow[], index: number, txns: PeriodTransaction[]) {
  const period = ordered[index];
  const lines = transactionsInPeriod(txns, period);
  const beginning = beginningBalanceFor(ordered, index);
  const summary = summarizePeriod(beginning, period.endingBalanceCents, lines);
  const fingerprint = periodFingerprint(beginning, period.endingBalanceCents, lines);
  const status = effectivePeriodStatus(period, fingerprint);
  return { period, lines, summary, fingerprint, status };
}

/**
 * Bank accounts with their statement periods, each with live balances, the
 * effective status (closed periods whose lines changed read out of balance)
 * and the defaults for starting the next period.
 */
export async function periodsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [accounts, periods, txns, profiles] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<PeriodRow>("reconciliationPeriods").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("bankAccountProfiles").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  // Accounts page details: archived accounts drop out unless they have statements;
  // an opening balance entered there seeds the first statement.
  const profileByAccount = new Map(profiles.map((row) => [String(row.accountId), row]));
  const txnRows: PeriodTransaction[] = txns.map((row: any) => ({ ...row, _id: String(row._id), accountId: String(row.accountId) }));
  const accountsWithActivity = new Set([...txnRows.map((t) => String(t.accountId)), ...periods.map((p) => String(p.accountId))]);
  const reconcilable = accounts.filter((account: any) =>
    (RECONCILABLE_ACCOUNT_TYPES.has(String(account.accountType ?? "").toLowerCase()) && !profileByAccount.get(String(account._id))?.archivedAtISO) ||
    periods.some((p) => String(p.accountId) === String(account._id)));
  const outPeriods: any[] = [];
  const outAccounts = reconcilable.map((account: any) => {
    const accountId = String(account._id);
    const ordered = orderPeriods(periods.filter((p) => String(p.accountId) === accountId));
    const described = ordered.map((_, index) => describePeriod(ordered, index, txnRows));
    for (const entry of described) {
      outPeriods.push({
        ...entry.period,
        accountName: account.name,
        effectiveStatus: entry.status,
        ...entry.summary,
        transactionIds: entry.lines.map((line) => String(line._id)),
      });
    }
    const last = ordered[ordered.length - 1];
    const accountTxns = txnRows.filter((t) => String(t.accountId) === accountId);
    const earliest = accountTxns.reduce<string | undefined>((min, t) => (!min || t.date < min ? t.date : min), undefined);
    const latestDescribed = described[described.length - 1];
    return {
      _id: accountId,
      name: account.name,
      code: account.code,
      accountType: account.accountType,
      currency: account.currency ?? "CAD",
      balanceCents: account.balanceCents ?? 0,
      hasActivity: accountsWithActivity.has(accountId),
      transactionCount: accountTxns.length,
      periodCount: ordered.length,
      latestStatus: latestDescribed?.status,
      latestEndDate: last?.endDate,
      lastReconciledThrough: [...described].reverse().find((d) => d.status === "completed" || d.status === "auto_reconciled")?.period.endDate,
      openPeriodId: ordered.find((p) => p.status === "in_progress")?._id,
      outOfBalanceCount: described.filter((d) => d.status === "out_of_balance").length,
      // Defaults for "Start reconciliation".
      nextStartDate: last ? addDaysToDateOnly(last.endDate, 1) : earliest,
      nextBeginningBalanceCents: last ? last.endingBalanceCents : undefined,
      needsOpeningBalance: !last,
      suggestedOpeningBalanceCents: last ? undefined : profileByAccount.get(accountId)?.openingBalanceCents,
      suggestedStartDate: last ? undefined : profileByAccount.get(accountId)?.openingDate,
      archived: Boolean(profileByAccount.get(accountId)?.archivedAtISO),
    };
  });
  outAccounts.sort((a, b) => Number(b.hasActivity) - Number(a.hasActivity) || String(a.code ?? a.name).localeCompare(String(b.code ?? b.name)));
  outPeriods.sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));
  return { accounts: outAccounts, periods: outPeriods };
}

async function principalName(ctx: PortableQueryCtx, societyId: string) {
  const id = await principalUserId(ctx, societyId);
  const user: any = await ctx.db.get(id, "users").catch(() => null);
  return { id: user ? id : undefined, name: String(user?.displayName ?? user?.name ?? "You") };
}

export async function startPeriodPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    accountId: string;
    startDate?: string;
    endDate: string;
    endingBalanceCents: number;
    openingBalanceCents?: number;
    statementDocumentId?: string;
    notes?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "financialAccounts", args.accountId, args.societyId);
  if (args.statementDocumentId) await getOwned(ctx, "documents", args.statementDocumentId, args.societyId);
  if (!isDateOnly(args.endDate)) throw new Error("Enter the statement end date.");
  if (!Number.isSafeInteger(args.endingBalanceCents)) throw new Error("Enter the statement ending balance.");
  const ordered = await accountPeriods(ctx, args.accountId);
  if (ordered.some((p) => p.status === "in_progress")) {
    throw new Error("Finish or discard the open reconciliation for this account first.");
  }
  const last = ordered[ordered.length - 1];
  const startDate = last ? addDaysToDateOnly(last.endDate, 1) : args.startDate;
  if (!startDate || !isDateOnly(startDate)) throw new Error("Enter the statement start date.");
  if (args.endDate < startDate) {
    throw new Error(last ? `The statement must end after ${last.endDate}, where the previous reconciliation ends.` : "The end date must be on or after the start date.");
  }
  if (!last && args.openingBalanceCents !== undefined && !Number.isSafeInteger(args.openingBalanceCents)) {
    throw new Error("Enter the opening balance.");
  }
  const nowISO = new Date().toISOString();
  const actor = await principalName(ctx, args.societyId);
  const draft: PeriodRow = {
    _id: "draft",
    societyId: args.societyId,
    accountId: args.accountId,
    startDate,
    endDate: args.endDate,
    openingBalanceCents: last ? undefined : Math.round(args.openingBalanceCents ?? 0),
    endingBalanceCents: args.endingBalanceCents,
    status: "in_progress",
  };
  // A statement whose every line is already cleared and balances is closed
  // straight away as auto-reconciled.
  const txns = await accountTransactions(ctx, args.accountId);
  const withDraft = [...ordered, draft];
  const { summary, fingerprint } = describePeriod(withDraft, withDraft.length - 1, txns);
  const auto = summary.transactionCount > 0 && summary.unclearedCount === 0 && summary.differenceCents === 0;
  return ctx.db.insert("reconciliationPeriods", {
    societyId: args.societyId,
    accountId: args.accountId,
    startDate,
    endDate: args.endDate,
    ...(last ? {} : { openingBalanceCents: Math.round(args.openingBalanceCents ?? 0) }),
    endingBalanceCents: args.endingBalanceCents,
    statementDocumentId: args.statementDocumentId,
    notes: args.notes?.trim() || undefined,
    status: auto ? "auto_reconciled" : "in_progress",
    ...(auto
      ? {
          completedAtISO: nowISO,
          completedByUserId: actor.id,
          completedByName: actor.name,
          clearedFingerprint: fingerprint,
          clearedCount: summary.clearedCount,
          clearedBalanceCents: summary.clearedBalanceCents,
        }
      : {}),
    createdByUserId: actor.id,
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
  });
}

export async function updatePeriodPortable(
  ctx: PortableMutationCtx,
  args: { id: string; endingBalanceCents?: number; openingBalanceCents?: number; statementDocumentId?: string; clearStatementDocument?: boolean; notes?: string },
) {
  const period = await requireOwnedRow<PeriodRow>(ctx, "reconciliationPeriods", args.id);
  if (period.status !== "in_progress") throw new Error("Reopen the reconciliation before changing it.");
  if (args.statementDocumentId) await getOwned(ctx, "documents", args.statementDocumentId, period.societyId);
  const patch: Record<string, unknown> = { updatedAtISO: new Date().toISOString() };
  if (args.endingBalanceCents !== undefined) {
    if (!Number.isSafeInteger(args.endingBalanceCents)) throw new Error("Enter the statement ending balance.");
    patch.endingBalanceCents = args.endingBalanceCents;
  }
  if (args.openingBalanceCents !== undefined) {
    const ordered = await accountPeriods(ctx, period.accountId);
    if (ordered[0]?._id !== period._id) throw new Error("Only the first reconciliation for an account has an opening balance.");
    if (!Number.isSafeInteger(args.openingBalanceCents)) throw new Error("Enter the opening balance.");
    patch.openingBalanceCents = args.openingBalanceCents;
  }
  if (args.statementDocumentId) patch.statementDocumentId = args.statementDocumentId;
  if (args.clearStatementDocument) patch.statementDocumentId = undefined;
  if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;
  await ctx.db.patch(args.id, patch);
  return args.id;
}

export async function completePeriodPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const period = await requireOwnedRow<PeriodRow>(ctx, "reconciliationPeriods", id);
  if (period.status !== "in_progress") throw new Error("This reconciliation is already closed.");
  const ordered = await accountPeriods(ctx, period.accountId);
  const index = ordered.findIndex((p) => p._id === id);
  const txns = await accountTransactions(ctx, period.accountId);
  const { summary, fingerprint } = describePeriod(ordered, index, txns);
  if (summary.differenceCents !== 0) {
    throw new Error("The difference must be $0.00 before you can complete this reconciliation.");
  }
  const nowISO = new Date().toISOString();
  const actor = await principalName(ctx, period.societyId);
  await ctx.db.patch(id, {
    status: "completed",
    completedAtISO: nowISO,
    completedByUserId: actor.id,
    completedByName: actor.name,
    clearedFingerprint: fingerprint,
    clearedCount: summary.clearedCount,
    clearedBalanceCents: summary.clearedBalanceCents,
    outOfBalanceAtISO: undefined,
    updatedAtISO: nowISO,
  });
  return id;
}

export async function reopenPeriodPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const period = await requireOwnedRow<PeriodRow>(ctx, "reconciliationPeriods", id);
  if (period.status === "in_progress") return id;
  const ordered = await accountPeriods(ctx, period.accountId);
  if (ordered.some((p) => p._id !== id && p.status === "in_progress")) {
    throw new Error("Finish or discard the open reconciliation for this account first.");
  }
  await ctx.db.patch(id, {
    status: "in_progress",
    completedAtISO: undefined,
    completedByUserId: undefined,
    completedByName: undefined,
    clearedFingerprint: undefined,
    clearedCount: undefined,
    clearedBalanceCents: undefined,
    updatedAtISO: new Date().toISOString(),
  });
  return id;
}

export async function removePeriodPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const period = await requireOwnedRow<PeriodRow>(ctx, "reconciliationPeriods", id);
  if (period.status !== "in_progress") throw new Error("Reopen the reconciliation before discarding it.");
  const ordered = await accountPeriods(ctx, period.accountId);
  if (ordered[ordered.length - 1]?._id !== id) throw new Error("Only the latest reconciliation for an account can be discarded.");
  await ctx.db.delete(id);
}

/**
 * Record that closed periods covering a changed transaction no longer match.
 * The periods query derives the same state for changes made elsewhere (CSV
 * import, sync, edits); this stamps when it was first detected.
 */
export async function flagChangedPeriods(ctx: PortableMutationCtx, accountId: string | undefined, date: string | undefined) {
  if (!accountId || !date) return;
  const ordered = await accountPeriods(ctx, accountId);
  const covering = ordered.filter((p) => isClosedStatus(p.status) && p.startDate <= date && p.endDate >= date);
  if (!covering.length) return;
  const txns = await accountTransactions(ctx, accountId);
  for (const period of covering) {
    const { status } = describePeriod(ordered, ordered.indexOf(period), txns);
    if (status === "out_of_balance" && period.status !== "out_of_balance") {
      await ctx.db.patch(period._id, { status: "out_of_balance", outOfBalanceAtISO: new Date().toISOString() });
    }
  }
}

/* ------------------------------------------- reconciliation by month */

type MonthTxnRow = PeriodTransaction & {
  description?: string;
  counterparty?: string;
  category?: string;
  accountingAccountId?: string;
  matchedKind?: string;
  reconciliationNote?: string;
  receiptDocumentId?: string;
};

/**
 * One account's year as a month strip (status per month from its statement
 * periods and lines) and, for a chosen month, its transactions with a running
 * balance, the statement covering it and whether that statement can be
 * auto-reconciled.
 */
export async function accountMonthsPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; accountId: string; year: number; month?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const account = await getOwned(ctx, "financialAccounts", args.accountId, args.societyId);
  const [{ periods }, rawTxns, profiles, ledgerAccounts] = await Promise.all([
    periodsPortable(ctx, { societyId: args.societyId }),
    ctx.db.query<MonthTxnRow>("financialTransactions").withIndex("by_account", (q) => q.eq("accountId", args.accountId)).collect(),
    ctx.db.query<PortableDoc & { openingBalanceCents?: number; openingDate?: string }>("bankAccountProfiles").withIndex("by_account", (q) => q.eq("accountId", args.accountId)).collect(),
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
  ]);
  const today = todayDateOnly();
  const txns = rawTxns.map((row) => ({ ...row, _id: String(row._id), accountId: String(row.accountId) }));
  const accountPeriodRows = periods.filter((period) => String(period.accountId) === String(args.accountId));
  const year = Number.isInteger(args.year) ? args.year : Number(today.slice(0, 4));
  const months = monthStatusesForYear(year, accountPeriodRows, txns.map((row) => row.date), today);
  const firstYear = Math.min(
    Number(today.slice(0, 4)),
    ...txns.map((row) => Number(row.date.slice(0, 4))),
    ...accountPeriodRows.map((period) => Number(String(period.startDate).slice(0, 4))),
  );
  const years = Array.from({ length: Number(today.slice(0, 4)) - firstYear + 1 }, (_, index) => firstYear + index).reverse();
  const profile = profiles[0] ?? null;
  const currentBalanceCents = bankAccountBalanceCents({ balanceCents: account.balanceCents }, profile, txns);

  const buildDetail = async (month: string) => {
    const { start, end } = monthBounds(month);
    const ledgerById = new Map(ledgerAccounts.map((row) => [String(row._id), row]));
    const inMonth = txns.filter((row) => row.date >= start && row.date <= end);
    const opening = balanceBefore(currentBalanceCents, txns, start);
    const lines = withRunningBalance(inMonth, opening).map((row) => {
      const ledger = row.accountingAccountId ? ledgerById.get(String(row.accountingAccountId)) : undefined;
      return {
        _id: row._id,
        date: row.date,
        description: row.description ?? "",
        counterparty: row.counterparty,
        amountCents: row.amountCents,
        balanceCents: row.balanceCents,
        reconciled: Boolean(row.reconciledAtISO),
        matchedKind: row.matchedKind,
        reconciliationNote: row.reconciliationNote,
        ledgerLabel: ledger ? (ledger.code ? `${ledger.code} · ${ledger.name}` : String(ledger.name)) : row.category && !/^uncategori[sz]ed$/i.test(row.category) ? row.category : undefined,
        hasReceipt: Boolean(row.receiptDocumentId),
      };
    });
    const status = months.find((entry) => entry.month === month);
    const period = status?.periodId ? accountPeriodRows.find((row) => String(row._id) === String(status.periodId)) : undefined;
    let autoReconcile: AutoReconcileReadiness | null = null;
    if (period && period.status === "in_progress") {
      const ordered = orderPeriods(accountPeriodRows);
      const index = ordered.findIndex((row) => String(row._id) === String(period._id));
      const periodLines = transactionsInPeriod(txns, period);
      autoReconcile = autoReconcileReadiness(beginningBalanceFor(ordered, index), period.endingBalanceCents, periodLines);
    }
    const statementDocument = period?.statementDocumentId
      ? await ctx.db.get(String(period.statementDocumentId), "documents").catch(() => null)
      : null;
    return {
      month,
      start,
      end,
      openingBalanceCents: opening,
      feedEndingBalanceCents: opening + inMonth.reduce((sum, row) => sum + row.amountCents, 0),
      lines,
      period: period
        ? {
            _id: String(period._id),
            startDate: period.startDate,
            endDate: period.endDate,
            status: period.status,
            effectiveStatus: period.effectiveStatus,
            beginningBalanceCents: period.beginningBalanceCents,
            clearedBalanceCents: period.clearedBalanceCents,
            endingBalanceCents: period.endingBalanceCents,
            differenceCents: period.differenceCents,
            clearedCount: period.clearedCount,
            transactionCount: period.transactionCount,
            unclearedCount: period.unclearedCount,
            completedAtISO: period.completedAtISO,
            completedByName: period.completedByName,
          }
        : null,
      statementDocument: statementDocument && String(statementDocument.societyId) === String(args.societyId)
        ? { _id: String(statementDocument._id), title: String(statementDocument.title ?? "Statement"), fileName: statementDocument.fileName as string | undefined }
        : null,
      autoReconcile,
    };
  };
  const detail = args.month && /^\d{4}-\d{2}$/.test(args.month) ? await buildDetail(args.month) : null;
  return {
    account: { _id: String(account._id), name: String(account.name), code: account.code as string | undefined, currency: String(account.currency ?? "CAD") },
    year,
    years,
    months,
    currentBalanceCents,
    detail,
  };
}

/**
 * Complete an open statement in one step when every line is matched or
 * categorised and clearing the categorised ones leaves no difference: those
 * lines are cleared as "categorised" and the statement closes auto-reconciled.
 */
export async function autoReconcilePeriodPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const period = await requireOwnedRow<PeriodRow>(ctx, "reconciliationPeriods", id);
  if (period.status !== "in_progress") throw new Error("This reconciliation is already closed.");
  const ordered = await accountPeriods(ctx, period.accountId);
  const index = ordered.findIndex((p) => p._id === id);
  const txns = await accountTransactions(ctx, period.accountId);
  const lines = transactionsInPeriod(txns, period) as Array<PeriodTransaction & { category?: string; accountingAccountId?: string }>;
  const readiness = autoReconcileReadiness(beginningBalanceFor(ordered, index), period.endingBalanceCents, lines);
  if (!readiness.ready) throw new Error(readiness.reason ?? "This statement can't be auto-reconciled yet.");
  const nowISO = new Date().toISOString();
  const actor = await principalName(ctx, period.societyId);
  for (const line of lines) {
    if (!readiness.toClearIds.includes(String(line._id))) continue;
    await ctx.db.patch(String(line._id), {
      reconciledAtISO: nowISO,
      reconciledByName: actor.name,
      matchedKind: "categorized",
      matchedId: String(line.accountingAccountId ?? line.category ?? "categorized"),
      reconciliationNote: `Auto-reconciled: categorised as ${line.category ?? "a ledger account"}`,
    });
  }
  const after = await accountTransactions(ctx, period.accountId);
  const { summary, fingerprint } = describePeriod(ordered, index, after);
  if (summary.differenceCents !== 0) throw new Error("The difference must be $0.00 before you can complete this reconciliation.");
  await ctx.db.patch(id, {
    status: "auto_reconciled",
    completedAtISO: nowISO,
    completedByUserId: actor.id,
    completedByName: actor.name,
    clearedFingerprint: fingerprint,
    clearedCount: summary.clearedCount,
    clearedBalanceCents: summary.clearedBalanceCents,
    outOfBalanceAtISO: undefined,
    updatedAtISO: nowISO,
  });
  return { cleared: readiness.toClearIds.length };
}
