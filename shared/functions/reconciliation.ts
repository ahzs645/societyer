/**
 * PORTABLE FUNCTIONS: the bank-reconciliation domain
 * (overview / match / markManual / addManualTransaction / unmatch).
 *
 * Reads/writes financialTransactions (plus financialConnections /
 * financialAccounts for manual entry) over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

/**
 * Returns every bank transaction with reconciliation status, plus a candidate
 * list of internal records (filings, donation receipts, employee payroll) that
 * could match each unreconciled line. Matching is heuristic — exact amount
 * within ±7 days for cash records, then string-similarity on counterparty.
 */
export async function overviewPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
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
  await ctx.db.patch(args.txnId, {
    reconciledAtISO: new Date().toISOString(),
    reconciledByName: args.actor ?? "You",
    matchedKind: args.matchedKind,
    matchedId: args.matchedId,
    reconciliationNote: args.note,
  });
}

export async function markManualPortable(
  ctx: PortableMutationCtx,
  { txnId, note, actor }: { txnId: string; note: string; actor?: string },
) {
  await ctx.db.patch(txnId, {
    reconciledAtISO: new Date().toISOString(),
    reconciledByName: actor ?? "You",
    matchedKind: "manual",
    matchedId: "manual",
    reconciliationNote: note,
  });
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
    connection = await ctx.db.get(connectionId);
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

  return ctx.db.insert("financialTransactions", {
    societyId: args.societyId,
    connectionId: connection!._id,
    accountId,
    externalId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: args.date,
    description: args.description,
    amountCents: args.amountCents,
    counterparty: args.counterparty,
    category: args.category,
  });
}

export async function unmatchPortable(ctx: PortableMutationCtx, { txnId }: { txnId: string }) {
  await ctx.db.patch(txnId, {
    reconciledAtISO: undefined,
    reconciledByName: undefined,
    matchedKind: undefined,
    matchedId: undefined,
    reconciliationNote: undefined,
  });
}
