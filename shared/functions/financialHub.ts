/**
 * PORTABLE FUNCTIONS: the financial hub read/write domain (connections,
 * accounts, transactions, transaction lookups by external id, budgets,
 * operating subscriptions).
 *
 * Only the pure `ctx.db` handlers live here. The sync/disconnect/connection
 * surface (anything that talks to Wave or the scheduler) stays on Convex.
 *
 * Each handler reads/writes exclusively through the portable `ctx.db` contract
 * and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle. Role-gated mutations call `requireRolePortable` so live
 * and offline enforce the same rule. `normalizeCategoryLabel` and
 * `monthlyEquivalentCents` are pure helpers shared by the ported handlers.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";

function normalizeCategoryLabel(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function monthlyEquivalentCents(amountCents: number, interval: string) {
  if (interval === "week") return Math.round((amountCents * 52) / 12);
  if (interval === "quarter") return Math.round(amountCents / 3);
  if (interval === "year") return Math.round(amountCents / 12);
  return amountCents;
}

/** A debit-normal account (Bank/Asset/Expense) increases on debit; everything
 *  else (Credit/Liability/Income/Equity) increases on credit. Used to sign
 *  journal lines when no explicit normalBalance is stored on the account. */
function defaultNormalBalance(accountType?: string): "debit" | "credit" {
  return ["Bank", "Asset", "Expense"].includes(String(accountType ?? "")) ? "debit" : "credit";
}

/** Derive each account's balance from POSTED journal lines (double-entry: a
 *  line moves the balance up when its side matches the account's normal
 *  balance, down otherwise). Returns a per-account posted balance plus whether
 *  the account had any posted lines at all, so callers can prefer the ledger
 *  where it exists and fall back to the imported balance otherwise. */
function computeLedgerBalances(accounts: any[], entries: any[], lines: any[]) {
  const postedEntryIds = new Set(
    entries.filter((e) => e.status === "posted").map((e) => String(e._id)),
  );
  const normalByAccount = new Map<string, "debit" | "credit">(
    accounts.map((a) => [
      String(a._id),
      (a.normalBalance === "debit" || a.normalBalance === "credit"
        ? a.normalBalance
        : defaultNormalBalance(a.accountType)) as "debit" | "credit",
    ]),
  );
  const result = new Map<string, { postedBalanceCents: number; hasPostedLines: boolean }>();
  for (const line of lines) {
    if (!postedEntryIds.has(String(line.journalEntryId))) continue;
    const acctId = String(line.accountId);
    const normal = normalByAccount.get(acctId) ?? "debit";
    const signed = line.side === normal ? line.amountCents : -line.amountCents;
    const cur = result.get(acctId) ?? { postedBalanceCents: 0, hasPostedLines: false };
    cur.postedBalanceCents += signed;
    cur.hasPostedLines = true;
    result.set(acctId, cur);
  }
  return result;
}

export async function connectionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("financialConnections")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function accountsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("financialAccounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function transactionsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  return ctx.db
    .query("financialTransactions")
    .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 100);
}

export async function transactionsForAccountExternalIdPortable(
  ctx: PortableQueryCtx,
  { societyId, externalId, limit }: { societyId: string; externalId: string; limit?: number },
) {
  const accounts = await ctx.db
    .query("financialAccounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const account = accounts.find((row) => row.externalId === externalId);
  if (!account) {
    return { account: null, transactions: [], total: 0 };
  }
  const rows = await ctx.db
    .query("financialTransactions")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  const transactions = rows
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit ?? 500);
  return {
    account,
    transactions,
    total: rows.length,
  };
}

export async function transactionsForCounterpartyExternalIdPortable(
  ctx: PortableQueryCtx,
  {
    societyId,
    externalId,
    resourceType,
    limit,
  }: { societyId: string; externalId: string; resourceType?: string; limit?: number },
) {
  const transactionQuery = resourceType
    ? ctx.db
        .query("financialTransactions")
        .withIndex("by_society_counterparty_external_type", (q) =>
          q.eq("societyId", societyId).eq("counterpartyExternalId", externalId).eq("counterpartyResourceType", resourceType),
        )
    : ctx.db
        .query("financialTransactions")
        .withIndex("by_society_counterparty_external", (q) =>
          q.eq("societyId", societyId).eq("counterpartyExternalId", externalId),
        );
  const [accounts, transactionRows, snapshots] = (await Promise.all([
    ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    transactionQuery.collect(),
    ctx.db
      .query("waveCacheSnapshots")
      .withIndex("by_society_provider", (q) => q.eq("societyId", societyId).eq("provider", "wave"))
      .order("desc")
      .take(1),
  ])) as [any[], any[], any[]];
  const accountById = new Map<string, any>(accounts.map((account) => [String(account._id), account]));
  const accountResourceByExternalId = new Map<string, any>();
  const latestSnapshot = snapshots[0];
  if (latestSnapshot) {
    const waveResources: any[] = await ctx.db
      .query("waveCacheResources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", latestSnapshot._id))
      .collect();
    for (const resource of waveResources) {
      if (resource.resourceType === "account" && resource.externalId) {
        accountResourceByExternalId.set(resource.externalId, {
          _id: resource._id,
          label: resource.label,
          resourceType: resource.resourceType,
        });
      }
    }
  }
  const rows = transactionRows.sort((a, b) => b.date.localeCompare(a.date));
  const linkedTotalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  return {
    transactions: rows.slice(0, limit ?? 500).map((row) => ({
      ...row,
      account: accountById.get(String(row.accountId)) ?? null,
      accountResource: accountById.get(String(row.accountId))?.externalId
        ? accountResourceByExternalId.get(accountById.get(String(row.accountId))!.externalId) ?? null
        : null,
    })),
    total: rows.length,
    linkedTotalCents,
  };
}

export async function transactionsForCategoryAccountExternalIdPortable(
  ctx: PortableQueryCtx,
  {
    societyId,
    externalId,
    label,
    limit,
  }: { societyId: string; externalId: string; label?: string; limit?: number },
) {
  const labelText = label?.trim();
  const normalizedLabel = normalizeCategoryLabel(labelText);
  const [accounts, rowsByExternalId, rowsByLabel, snapshots] = (await Promise.all([
    ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("financialTransactions")
      .withIndex("by_society_category_account_external", (q) =>
        q.eq("societyId", societyId).eq("categoryAccountExternalId", externalId),
      )
      .collect(),
    labelText
      ? ctx.db
          .query("financialTransactions")
          .withIndex("by_society_category", (q) => q.eq("societyId", societyId).eq("category", labelText))
          .collect()
      : Promise.resolve([]),
    ctx.db
      .query("waveCacheSnapshots")
      .withIndex("by_society_provider", (q) => q.eq("societyId", societyId).eq("provider", "wave"))
      .order("desc")
      .take(1),
  ])) as [any[], any[], any[], any[]];
  const accountById = new Map<string, any>(accounts.map((account) => [String(account._id), account]));
  const accountResourceByExternalId = new Map<string, any>();
  const latestSnapshot = snapshots[0];
  if (latestSnapshot) {
    const waveResources: any[] = await ctx.db
      .query("waveCacheResources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", latestSnapshot._id))
      .collect();
    for (const resource of waveResources) {
      if (resource.resourceType === "account" && resource.externalId) {
        accountResourceByExternalId.set(resource.externalId, {
          _id: resource._id,
          label: resource.label,
          resourceType: resource.resourceType,
        });
      }
    }
  }
  const rowById = new Map<string, any>(rowsByExternalId.map((row) => [String(row._id), row]));
  for (const row of rowsByLabel) {
    if (!row.categoryAccountExternalId && normalizedLabel && normalizeCategoryLabel(row.category) === normalizedLabel) {
      rowById.set(String(row._id), row);
    }
  }
  const rows = Array.from(rowById.values()).sort((a, b) => b.date.localeCompare(a.date));
  const linkedTotalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  return {
    transactions: rows.slice(0, limit ?? 500).map((row) => {
      const account = accountById.get(String(row.accountId)) ?? null;
      return {
        ...row,
        account,
        accountResource: account?.externalId ? accountResourceByExternalId.get(account.externalId) ?? null : null,
      };
    }),
    total: rows.length,
    linkedTotalCents,
  };
}

export async function budgetsPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear }: { societyId: string; fiscalYear?: string },
) {
  const rows = await ctx.db
    .query("budgets")
    .withIndex("by_society_fy", (q) =>
      fiscalYear ? q.eq("societyId", societyId).eq("fiscalYear", fiscalYear) : q.eq("societyId", societyId),
    )
    .collect();
  return rows;
}

export async function operatingSubscriptionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("operatingSubscriptions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows
    .map((row) => {
      const monthlyEstimateCents = monthlyEquivalentCents(row.amountCents, row.interval);
      return {
        ...row,
        monthlyEstimateCents,
        annualEstimateCents: monthlyEstimateCents * 12,
      };
    })
    .sort((a: any, b: any) => `${a.status}:${a.name}`.localeCompare(`${b.status}:${b.name}`));
}

export async function upsertBudgetPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    fiscalYear: string;
    category: string;
    plannedCents: number;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  if (id) {
    await ctx.db.patch(id, rest);
    return id;
  }
  return await ctx.db.insert("budgets", rest);
}

export async function upsertOperatingSubscriptionPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    name: string;
    vendorName?: string;
    category: string;
    amountCents: number;
    currency: string;
    interval: string;
    status: string;
    nextRenewalDate?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  const now = new Date().toISOString();
  if (id) {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Subscription cost row not found.");
    if (row.societyId !== args.societyId) throw new Error("Subscription cost row belongs to another society.");
    await ctx.db.patch(id, { ...rest, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("operatingSubscriptions", {
    ...rest,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function removeOperatingSubscriptionPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Director" });
  await ctx.db.delete(id);
}

export async function removeBudgetPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Director" });
  await ctx.db.delete(id);
}

export async function getConnectionPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

// Edit a single imported/synced transaction. Only the user-correctable fields
// (date, description, category, counterparty, amount) are patchable; the
// account binding and external/source identifiers stay immutable.
export async function updateTransactionPortable(
  ctx: PortableMutationCtx,
  {
    id,
    patch,
    actingUserId,
  }: {
    id: string;
    patch: {
      date?: string;
      description?: string;
      category?: string;
      counterparty?: string;
      amountCents?: number;
    };
    actingUserId?: string;
  },
) {
  const row = await ctx.db.get(id);
  if (!row) throw new Error("Transaction not found.");
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Director" });
  await ctx.db.patch(id, patch);
  return id;
}

// A small derived query for the dashboard — balances by purpose/category.
// Prefers balances computed from posted journal lines (the durable double-entry
// ledger) where an account has any, falling back to the imported balanceCents.
export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const [accounts, transactions, budgets, journalEntries, journalLines] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("budgets").withIndex("by_society_fy", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalEntries").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalLines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);

  const ledger = computeLedgerBalances(accounts, journalEntries, journalLines);
  const effectiveBalance = (a: any) => {
    const entry = ledger.get(String(a._id));
    return entry && entry.hasPostedLines ? entry.postedBalanceCents : a.balanceCents;
  };
  const isLedgerBacked = (a: any) => ledger.get(String(a._id))?.hasPostedLines === true;

  const bank = accounts.filter((a) => a.accountType === "Bank" || a.accountType === "Credit");
  const totalBalance = bank.reduce((sum, a) => sum + effectiveBalance(a), 0);
  const restricted = bank.filter((a) => a.isRestricted);
  const unrestricted = totalBalance - restricted.reduce((sum, a) => sum + effectiveBalance(a), 0);

  const actualsByCategory: Record<string, number> = {};
  for (const t of transactions) {
    if (!t.category) continue;
    actualsByCategory[t.category] = (actualsByCategory[t.category] ?? 0) + Math.abs(t.amountCents);
  }

  const budgetRows = budgets.map((b) => ({
    ...b,
    actualCents: actualsByCategory[b.category] ?? 0,
  }));

  return {
    totalBalance,
    unrestricted,
    // How many bank/credit accounts are now reading from the posted ledger
    // vs the imported balance — lets the UI show ledger coverage.
    ledgerBackedAccounts: bank.filter(isLedgerBacked).length,
    bankAccountCount: bank.length,
    restrictedAccounts: restricted.map((a) => ({
      name: a.name,
      balanceCents: effectiveBalance(a),
      purpose: a.restrictedPurpose,
      ledgerBacked: isLedgerBacked(a),
    })),
    budgetRows,
    recentTransactions: transactions
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10),
  };
}
