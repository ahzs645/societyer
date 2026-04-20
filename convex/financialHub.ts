// @ts-nocheck
import { v } from "convex/values";
import { query, internalMutation, mutation, action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import {
  waveListAccounts,
  waveListTransactions,
} from "./providers/accounting";
import { providers } from "./providers/env";
import { redactWaveDiagnostic } from "./providers/waveDiagnostics";

export const connections = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("financialConnections")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const accounts = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const transactions = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  handler: async (ctx, { societyId, limit }) =>
    ctx.db
      .query("financialTransactions")
      .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 100),
});

export const transactionsForAccountExternalId = query({
  args: {
    societyId: v.id("societies"),
    externalId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { societyId, externalId, limit }) => {
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
  },
});

export const budgets = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  handler: async (ctx, { societyId, fiscalYear }) => {
    const rows = await ctx.db
      .query("budgets")
      .withIndex("by_society_fy", (q) =>
        fiscalYear ? q.eq("societyId", societyId).eq("fiscalYear", fiscalYear) : q.eq("societyId", societyId),
      )
      .collect();
    return rows;
  },
});

export const operatingSubscriptions = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
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
      .sort((a, b) => `${a.status}:${a.name}`.localeCompare(`${b.status}:${b.name}`));
  },
});

export const upsertBudget = mutation({
  args: {
    id: v.optional(v.id("budgets")),
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    category: v.string(),
    plannedCents: v.number(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, {
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
  },
});

export const upsertOperatingSubscription = mutation({
  args: {
    id: v.optional(v.id("operatingSubscriptions")),
    societyId: v.id("societies"),
    name: v.string(),
    vendorName: v.optional(v.string()),
    category: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    interval: v.string(),
    status: v.string(),
    nextRenewalDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, {
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
  },
});

export const removeOperatingSubscription = mutation({
  args: { id: v.id("operatingSubscriptions"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { id, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await requireRole(ctx, { actingUserId, societyId: row.societyId, required: "Director" });
    await ctx.db.delete(id);
  },
});

export const removeBudget = mutation({
  args: { id: v.id("budgets"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { id, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await requireRole(ctx, { actingUserId, societyId: row.societyId, required: "Director" });
    await ctx.db.delete(id);
  },
});

function monthlyEquivalentCents(amountCents: number, interval: string) {
  if (interval === "week") return Math.round((amountCents * 52) / 12);
  if (interval === "quarter") return Math.round(amountCents / 3);
  if (interval === "year") return Math.round(amountCents / 12);
  return amountCents;
}

export const oauthUrl = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const p = providers.accounting();
    const society = await ctx.db.get(societyId);
    return {
      provider: p.id,
      live: p.live,
      demoAvailable: society?.demoMode === true,
    };
  },
});

export const markConnectionConnected = mutation({
  args: {
    societyId: v.id("societies"),
    provider: v.string(),
    accountLabel: v.optional(v.string()),
    externalBusinessId: v.optional(v.string()),
    demo: v.boolean(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });
    const society = await ctx.db.get(args.societyId);
    if (args.demo && society?.demoMode !== true) {
      throw new Error("Demo Wave data can only be connected to a demo society.");
    }
    const existing = await ctx.db
      .query("financialConnections")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const match = existing.find((c) => c.provider === args.provider);
    const payload = {
      societyId: args.societyId,
      provider: args.provider,
      status: "connected",
      accountLabel: args.accountLabel,
      externalBusinessId: args.externalBusinessId,
      connectedAtISO: new Date().toISOString(),
      demo: args.demo,
    };
    if (match) {
      await ctx.db.patch(match._id, payload);
      return match._id;
    }
    return await ctx.db.insert("financialConnections", payload);
  },
});

export const disconnect = mutation({
  args: { connectionId: v.id("financialConnections"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { connectionId, actingUserId }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return;
    await requireRole(ctx, { actingUserId, societyId: conn.societyId, required: "Admin" });
    await ctx.db.patch(connectionId, { status: "disconnected" });
  },
});

export const removeDemoData = mutation({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { societyId, actingUserId }) => {
    await requireRole(ctx, { actingUserId, societyId, required: "Admin" });

    const connections = await ctx.db
      .query("financialConnections")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const demoConnections = connections.filter(isDemoFinancialConnection);
    const demoConnectionIds = new Set(demoConnections.map((row) => row._id));

    const counts = {
      connections: 0,
      accounts: 0,
      transactions: 0,
      waveCacheSnapshots: 0,
      waveCacheResources: 0,
      waveCacheStructures: 0,
      notifications: 0,
    };

    const transactions = await ctx.db
      .query("financialTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const row of transactions) {
      if (!demoConnectionIds.has(row.connectionId)) continue;
      await ctx.db.delete(row._id);
      counts.transactions += 1;
    }

    const accounts = await ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const row of accounts) {
      if (!demoConnectionIds.has(row.connectionId)) continue;
      await ctx.db.delete(row._id);
      counts.accounts += 1;
    }

    const snapshots = await ctx.db
      .query("waveCacheSnapshots")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const snapshot of snapshots) {
      if (!isDemoWaveSnapshot(snapshot, demoConnectionIds)) continue;
      const resources = await ctx.db
        .query("waveCacheResources")
        .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
        .collect();
      for (const row of resources) {
        await ctx.db.delete(row._id);
        counts.waveCacheResources += 1;
      }
      const structures = await ctx.db
        .query("waveCacheStructures")
        .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
        .collect();
      for (const row of structures) {
        await ctx.db.delete(row._id);
        counts.waveCacheStructures += 1;
      }
      await ctx.db.delete(snapshot._id);
      counts.waveCacheSnapshots += 1;
    }

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const row of notifications) {
      if (!isDemoFinancialNotification(row)) continue;
      await ctx.db.delete(row._id);
      counts.notifications += 1;
    }

    for (const row of demoConnections) {
      await ctx.db.delete(row._id);
      counts.connections += 1;
    }

    return counts;
  },
});

// Internal mutation the sync action calls to replace accounts/transactions
// after talking to Wave.
export const _replaceSyncedData = internalMutation({
  args: {
    societyId: v.id("societies"),
    connectionId: v.id("financialConnections"),
    accounts: v.array(
      v.object({
        externalId: v.string(),
        name: v.string(),
        currency: v.string(),
        accountType: v.string(),
        balanceCents: v.number(),
        isRestricted: v.boolean(),
        restrictedPurpose: v.optional(v.string()),
      }),
    ),
    transactions: v.array(
      v.object({
        externalId: v.string(),
        accountExternalId: v.string(),
        date: v.string(),
        description: v.string(),
        amountCents: v.number(),
        category: v.optional(v.string()),
        counterparty: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const prevAccounts = await ctx.db
      .query("financialAccounts")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .collect();
    for (const a of prevAccounts) await ctx.db.delete(a._id);

    const prevTx = await ctx.db
      .query("financialTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    for (const t of prevTx) {
      if (t.connectionId === args.connectionId) await ctx.db.delete(t._id);
    }

    const idByExternal: Record<string, Id<"financialAccounts">> = {};
    for (const a of args.accounts) {
      const id = await ctx.db.insert("financialAccounts", {
        societyId: args.societyId,
        connectionId: args.connectionId,
        externalId: a.externalId,
        name: a.name,
        currency: a.currency,
        accountType: a.accountType,
        balanceCents: a.balanceCents,
        isRestricted: a.isRestricted,
        restrictedPurpose: a.restrictedPurpose,
      });
      idByExternal[a.externalId] = id;
    }

    for (const t of args.transactions) {
      const accountId = idByExternal[t.accountExternalId];
      if (!accountId) continue;
      await ctx.db.insert("financialTransactions", {
        societyId: args.societyId,
        connectionId: args.connectionId,
        accountId,
        externalId: t.externalId,
        date: t.date,
        description: t.description,
        amountCents: t.amountCents,
        category: t.category,
        counterparty: t.counterparty,
      });
    }

    await ctx.db.patch(args.connectionId, {
      lastSyncAtISO: new Date().toISOString(),
      status: "connected",
      lastError: undefined,
    });
  },
});

export const sync = action({
  args: { connectionId: v.id("financialConnections") },
  handler: async (ctx, { connectionId }) => {
    const conn = await ctx.runQuery(api.financialHub.getConnection, { id: connectionId });
    if (!conn) throw new Error("Connection not found.");
    const society = await ctx.runQuery(api.society.getById, { id: conn.societyId });
    const allowDemo = conn.demo === true && society?.demoMode === true;
    try {
      const accountResult = await waveListAccounts({ allowDemo });
      const transactionResult = await waveListTransactions({ allowDemo });
      const { accounts } = accountResult;
      const { transactions } = transactionResult;
      if ((accountResult.provider === "demo" || transactionResult.provider === "demo") && !allowDemo) {
        throw new Error("Live Wave credentials are not configured; refusing to sync demo data into this society.");
      }
      await ctx.runMutation(internal.financialHub._replaceSyncedData, {
        societyId: conn.societyId,
        connectionId,
        accounts,
        transactions,
      });
      await ctx.runMutation(api.notifications.create, {
        societyId: conn.societyId,
        kind: "general",
        severity: "success",
        title: `Synced ${accounts.length} accounts from ${conn.provider}`,
        body: `${transactions.length} transactions imported.`,
        linkHref: "/financials",
      });
      return { accounts: accounts.length, transactions: transactions.length };
    } catch (err: any) {
      const safeError = redactWaveDiagnostic(err?.message ?? "Unknown error");
      await ctx.runMutation(internal.financialHub._markSyncError, {
        connectionId,
        error: safeError,
      });
      throw new Error(safeError);
    }
  },
});

export const getConnection = query({
  args: { id: v.id("financialConnections") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const _markSyncError = internalMutation({
  args: { connectionId: v.id("financialConnections"), error: v.string() },
  handler: async (ctx, { connectionId, error }) => {
    await ctx.db.patch(connectionId, { status: "error", lastError: error });
  },
});

// A small derived query for the dashboard — balances by purpose/category.
export const summary = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const [accounts, transactions, budgets] = await Promise.all([
      ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("budgets").withIndex("by_society_fy", (q) => q.eq("societyId", societyId)).collect(),
    ]);

    const bank = accounts.filter((a) => a.accountType === "Bank" || a.accountType === "Credit");
    const totalBalance = bank.reduce((sum, a) => sum + a.balanceCents, 0);
    const restricted = bank.filter((a) => a.isRestricted);
    const unrestricted = totalBalance - restricted.reduce((sum, a) => sum + a.balanceCents, 0);

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
      restrictedAccounts: restricted.map((a) => ({
        name: a.name,
        balanceCents: a.balanceCents,
        purpose: a.restrictedPurpose,
      })),
      budgetRows,
      recentTransactions: transactions
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10),
    };
  },
});

function isDemoFinancialConnection(row: any) {
  return (
    row.demo === true ||
    row.externalBusinessId === "biz_demo_01" ||
    row.externalBusinessId === "demo_wave_business" ||
    /riverside demo book/i.test(row.accountLabel ?? "")
  );
}

function isDemoWaveSnapshot(row: any, demoConnectionIds: Set<string>) {
  return (
    (row.connectionId && demoConnectionIds.has(row.connectionId)) ||
    row.businessId === "biz_demo_01" ||
    row.businessId === "demo_wave_business" ||
    /riverside demo book/i.test(row.businessName ?? "")
  );
}

function isDemoFinancialNotification(row: any) {
  if (row.linkHref !== "/financials") return false;
  return (
    /riverside demo book/i.test(row.title ?? "") ||
    (row.title === "Synced 9 accounts from wave" && row.body === "10 transactions imported.")
  );
}
