// @ts-nocheck
import { v } from "convex/values";
import { query, internalMutation, mutation, action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import {
  waveListAccounts,
  waveListTransactions,
  waveOAuthUrl,
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

export const removeBudget = mutation({
  args: { id: v.id("budgets"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { id, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await requireRole(ctx, { actingUserId, societyId: row.societyId, required: "Director" });
    await ctx.db.delete(id);
  },
});

export const oauthUrl = query({
  args: { societyId: v.id("societies") },
  handler: async (_ctx, { societyId }) => {
    const p = providers.accounting();
    return {
      provider: p.id,
      live: p.live,
      url: waveOAuthUrl({
        redirectUri: "http://localhost:5173/financials",
        state: societyId,
      }),
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
    try {
      const { accounts } = await waveListAccounts();
      const { transactions } = await waveListTransactions();
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
