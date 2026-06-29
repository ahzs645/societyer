import { v } from "convex/values";
import { query, internalMutation, mutation, action } from "./lib/untypedServer";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import {
  waveListAccounts,
  waveListTransactions,
} from "./providers/accounting";
import { providers } from "./providers/env";
import { redactWaveDiagnostic } from "./providers/waveDiagnostics";
import {
  connectionsPortable,
  accountsPortable,
  transactionsPortable,
  transactionsForAccountExternalIdPortable,
  transactionsForCounterpartyExternalIdPortable,
  transactionsForCategoryAccountExternalIdPortable,
  budgetsPortable,
  operatingSubscriptionsPortable,
  upsertBudgetPortable,
  upsertOperatingSubscriptionPortable,
  removeOperatingSubscriptionPortable,
  removeBudgetPortable,
} from "../shared/functions/financialHub";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const connections = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => connectionsPortable(toPortableQueryCtx(ctx), args),
});

export const accounts = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => accountsPortable(toPortableQueryCtx(ctx), args),
});

export const transactions = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: (ctx, args) => transactionsPortable(toPortableQueryCtx(ctx), args),
});

export const transactionsForAccountExternalId = query({
  args: {
    societyId: v.id("societies"),
    externalId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: (ctx, args) => transactionsForAccountExternalIdPortable(toPortableQueryCtx(ctx), args),
});

export const transactionsForCounterpartyExternalId = query({
  args: {
    societyId: v.id("societies"),
    externalId: v.string(),
    resourceType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: (ctx, args) => transactionsForCounterpartyExternalIdPortable(toPortableQueryCtx(ctx), args),
});

export const transactionsForCategoryAccountExternalId = query({
  args: {
    societyId: v.id("societies"),
    externalId: v.string(),
    label: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: (ctx, args) => transactionsForCategoryAccountExternalIdPortable(toPortableQueryCtx(ctx), args),
});

export const budgets = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => budgetsPortable(toPortableQueryCtx(ctx), args),
});

export const operatingSubscriptions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => operatingSubscriptionsPortable(toPortableQueryCtx(ctx), args),
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
  returns: v.any(),
  handler: (ctx, args) => upsertBudgetPortable(toPortableMutationCtx(ctx), args),
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
  returns: v.any(),
  handler: (ctx, args) => upsertOperatingSubscriptionPortable(toPortableMutationCtx(ctx), args),
});

export const removeOperatingSubscription = mutation({
  args: { id: v.id("operatingSubscriptions"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => removeOperatingSubscriptionPortable(toPortableMutationCtx(ctx), args),
});

export const removeBudget = mutation({
  args: { id: v.id("budgets"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => removeBudgetPortable(toPortableMutationCtx(ctx), args),
});

// Edit a single imported/synced transaction. Only the user-correctable fields
// (date, description, category, counterparty, amount) are patchable; the
// account binding and external/source identifiers stay immutable.
export const updateTransaction = mutation({
  args: {
    id: v.id("financialTransactions"),
    patch: v.object({
      date: v.optional(v.string()),
      description: v.optional(v.string()),
      category: v.optional(v.string()),
      counterparty: v.optional(v.string()),
      amountCents: v.optional(v.number()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Transaction not found.");
    await requireRole(ctx, { actingUserId, societyId: row.societyId, required: "Director" });
    await ctx.db.patch(id, patch);
    return id;
  },
});

export const oauthUrl = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
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
  returns: v.any(),
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
      syncMode: args.demo ? "demo" : "public_api",
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
  returns: v.any(),
  handler: async (ctx, { connectionId, actingUserId }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return;
    await requireRole(ctx, { actingUserId, societyId: conn.societyId, required: "Admin" });
    await ctx.db.patch(connectionId, { status: "disconnected" });
  },
});

export const removeDemoData = mutation({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { societyId, actingUserId }) => {
    await requireRole(ctx, { actingUserId, societyId, required: "Admin" });

    const connections = await ctx.db
      .query("financialConnections")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const demoConnections = connections.filter(isDemoFinancialConnection);
    const demoConnectionIds = new Set<string>((demoConnections as any[]).map((row) => String(row._id)));

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

    const accounts: any[] = await ctx.db
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
        categoryAccountExternalId: v.optional(v.string()),
        counterparty: v.optional(v.string()),
        counterpartyExternalId: v.optional(v.string()),
        counterpartyResourceType: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
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
        categoryAccountExternalId: t.categoryAccountExternalId,
        counterparty: t.counterparty,
        counterpartyExternalId: t.counterpartyExternalId,
        counterpartyResourceType: t.counterpartyResourceType,
      });
    }

    await ctx.db.patch(args.connectionId, {
      lastSyncAtISO: new Date().toISOString(),
      status: "connected",
      lastError: undefined,
    });
  },
});

export const importBrowserWaveTransactions = mutation({
  args: {
    societyId: v.id("societies"),
    businessId: v.string(),
    profileKey: v.optional(v.string()),
    accounts: v.array(
      v.object({
        externalId: v.string(),
        name: v.string(),
        currency: v.string(),
        accountType: v.string(),
        balanceCents: v.optional(v.number()),
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
        categoryAccountExternalId: v.optional(v.string()),
        counterparty: v.optional(v.string()),
        counterpartyExternalId: v.optional(v.string()),
        counterpartyResourceType: v.optional(v.string()),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });

    const now = new Date().toISOString();
    const existingConnections = await ctx.db
      .query("financialConnections")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const connection =
      existingConnections.find((row) => row.provider === "wave" && row.externalBusinessId === args.businessId) ??
      existingConnections.find((row) => row.provider === "wave");

    const connectionPayload = {
      societyId: args.societyId,
      provider: "wave",
      status: "connected",
      accountLabel: args.profileKey ? `Wave browser profile ${args.profileKey}` : "Wave browser connector",
      externalBusinessId: args.businessId,
      syncMode: "browser",
      connectedAtISO: connection?.connectedAtISO ?? now,
      lastSyncAtISO: now,
      lastError: undefined,
      demo: false,
    };
    const connectionId = connection
      ? (await ctx.db.patch(connection._id, connectionPayload), connection._id)
      : await ctx.db.insert("financialConnections", connectionPayload);

    const existingAccounts: any[] = await ctx.db
      .query("financialAccounts")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect();
    const existingByExternal = new Map(existingAccounts.map((account) => [account.externalId, account]));
    const accountIdByExternal = new Map(existingAccounts.map((account) => [account.externalId, account._id]));

    const uniqueAccounts = new Map<string, any>(args.accounts.map((account: any) => [account.externalId, account]));
    for (const account of uniqueAccounts.values()) {
      const existing = existingByExternal.get(account.externalId);
      const payload = {
        societyId: args.societyId,
        connectionId,
        externalId: account.externalId,
        name: account.name,
        currency: account.currency,
        accountType: account.accountType,
        balanceCents: account.balanceCents ?? existing?.balanceCents ?? 0,
        isRestricted: account.isRestricted,
        restrictedPurpose: account.restrictedPurpose,
      };
      if (existing) {
        await ctx.db.patch(existing._id, payload);
        accountIdByExternal.set(account.externalId, existing._id);
      } else {
        const id = await ctx.db.insert("financialAccounts", payload);
        accountIdByExternal.set(account.externalId, id);
      }
    }

    const previousTransactions = await ctx.db
      .query("financialTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    for (const transaction of previousTransactions) {
      if (transaction.connectionId === connectionId) await ctx.db.delete(transaction._id);
    }

    let insertedTransactions = 0;
    let skippedTransactions = 0;
    const seenTransactionIds = new Set<string>();
    for (const transaction of args.transactions) {
      if (seenTransactionIds.has(transaction.externalId)) continue;
      seenTransactionIds.add(transaction.externalId);

      let accountId = accountIdByExternal.get(transaction.accountExternalId);
      if (!accountId) {
        accountId = await ctx.db.insert("financialAccounts", {
          societyId: args.societyId,
          connectionId,
          externalId: transaction.accountExternalId,
          name: "Wave account",
          currency: "CAD",
          accountType: "Asset",
          balanceCents: 0,
          isRestricted: false,
        });
        accountIdByExternal.set(transaction.accountExternalId, accountId);
      }

      if (!transaction.date) {
        skippedTransactions += 1;
        continue;
      }

      await ctx.db.insert("financialTransactions", {
        societyId: args.societyId,
        connectionId,
        accountId,
        externalId: transaction.externalId,
        date: transaction.date,
        description: transaction.description,
        amountCents: transaction.amountCents,
        category: transaction.category,
        categoryAccountExternalId: transaction.categoryAccountExternalId,
        counterparty: transaction.counterparty,
        counterpartyExternalId: transaction.counterpartyExternalId,
        counterpartyResourceType: transaction.counterpartyResourceType,
      });
      insertedTransactions += 1;
    }

    return {
      connectionId,
      accounts: accountIdByExternal.size,
      importedAccounts: uniqueAccounts.size,
      transactions: insertedTransactions,
      skippedTransactions,
      syncedAtISO: now,
    };
  },
});

export const sync = action({
  args: { connectionId: v.id("financialConnections") },
  returns: v.any(),
  handler: async (ctx, { connectionId }) => {
    const conn = await ctx.runQuery(api.financialHub.getConnection, { id: connectionId });
    if (!conn) throw new Error("Connection not found.");
    if (isBrowserWaveConnection(conn)) {
      throw new Error("This Wave connection is browser-backed. Refresh it from Plugin connections with Pull all & save so the public Wave API does not overwrite ledger transactions.");
    }
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
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const _markSyncError = internalMutation({
  args: { connectionId: v.id("financialConnections"), error: v.string() },
  returns: v.any(),
  handler: async (ctx, { connectionId, error }) => {
    await ctx.db.patch(connectionId, { status: "error", lastError: error });
  },
});

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

// A small derived query for the dashboard — balances by purpose/category.
// Prefers balances computed from posted journal lines (the durable double-entry
// ledger) where an account has any, falling back to the imported balanceCents.
export const summary = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
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
  },
});

// Import bank / credit-card statement rows (parsed from CSV client-side) into an
// existing account. Wave's public API can't return ledger rows, so CSV import is
// the documented way to get real history in. Deduped per account by externalId
// (falling back to a deterministic date+amount+index key) so re-importing the
// same statement doesn't double-post.
export const importBankCsvTransactions = mutation({
  args: {
    societyId: v.id("societies"),
    accountId: v.id("financialAccounts"),
    rows: v.array(
      v.object({
        date: v.string(),
        description: v.string(),
        amountCents: v.number(),
        externalId: v.optional(v.string()),
        category: v.optional(v.string()),
        counterparty: v.optional(v.string()),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Admin" });
    const account = await ctx.db.get(args.accountId);
    if (!account || account.societyId !== args.societyId) {
      throw new Error("Account must belong to this society.");
    }
    const existing = await ctx.db
      .query("financialTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const seen = new Set(
      existing.filter((t) => t.accountId === args.accountId).map((t) => t.externalId),
    );

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < args.rows.length; i++) {
      const row = args.rows[i];
      const externalId =
        row.externalId?.trim() ||
        `csv:${String(args.accountId)}:${row.date}:${row.amountCents}:${i}`;
      if (seen.has(externalId)) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("financialTransactions", {
        societyId: args.societyId,
        connectionId: account.connectionId,
        accountId: args.accountId,
        externalId,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
        category: row.category,
        counterparty: row.counterparty,
      });
      seen.add(externalId);
      inserted += 1;
    }
    return { inserted, skipped, total: args.rows.length };
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

function isBrowserWaveConnection(row: any) {
  return (
    row.provider === "wave" &&
    (row.syncMode === "browser" || /wave browser/i.test(row.accountLabel ?? ""))
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
