import { operatorWaveBusinessId, providerDeploymentEnv } from "../shared/providerWorkspaceBindings";
import { authorizedAction, authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { v } from "convex/values";
import { query, internalMutation, mutation, action } from "./lib/untypedServer";
import { api, internal } from "./_generated/api";
import { requireRole } from "./users";
import {
  waveListAccounts,
  waveListTransactions,
} from "./providers/accounting";
import { providers } from "./providers/env";
import { redactWaveDiagnostic } from "./providers/waveDiagnostics";
import { invalidRuleIds, rulePatchForTransaction, ruleReferenceIndex } from "../shared/transactionRules";
import { aliasedCounterparty } from "../shared/payeeAliases";
import { assertProviderConnectionRemovable, importBrowserWaveTransactionsPortable, refreshFinancialProviderDataPortable } from "../shared/functions/financialProviderRefresh";
import {
  connectionsPortable,
  disconnectPortable,
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
  saveBudgetLinesPortable,
  getConnectionPortable,
  updateTransactionPortable,
  bulkUpdateTransactionsPortable,
  restoreTransactionsPortable,
  summaryPortable,
} from "../shared/functions/financialHub";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import {
  getOwned,
  requireSocietyMembership,
} from "../shared/functions/access";

export const connections = authorizedQuery("financialHub:connections", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => connectionsPortable(await toPortableQueryCtx(ctx), args),
});

export const accounts = authorizedQuery("financialHub:accounts", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => accountsPortable(await toPortableQueryCtx(ctx), args),
});

export const transactions = authorizedQuery("financialHub:transactions", query)({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => transactionsPortable(await toPortableQueryCtx(ctx), args),
});

export const transactionsForAccountExternalId = authorizedQuery("financialHub:transactionsForAccountExternalId", query)({
  args: {
    societyId: v.id("societies"),
    externalId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => transactionsForAccountExternalIdPortable(await toPortableQueryCtx(ctx), args),
});

export const transactionsForCounterpartyExternalId = authorizedQuery("financialHub:transactionsForCounterpartyExternalId", query)({
  args: {
    societyId: v.id("societies"),
    externalId: v.string(),
    resourceType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => transactionsForCounterpartyExternalIdPortable(await toPortableQueryCtx(ctx), args),
});

export const transactionsForCategoryAccountExternalId = authorizedQuery("financialHub:transactionsForCategoryAccountExternalId", query)({
  args: {
    societyId: v.id("societies"),
    externalId: v.string(),
    label: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => transactionsForCategoryAccountExternalIdPortable(await toPortableQueryCtx(ctx), args),
});

export const budgets = authorizedQuery("financialHub:budgets", query)({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => budgetsPortable(await toPortableQueryCtx(ctx), args),
});

export const operatingSubscriptions = authorizedQuery("financialHub:operatingSubscriptions", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => operatingSubscriptionsPortable(await toPortableQueryCtx(ctx), args),
});

export const upsertBudget = authorizedMutation("financialHub:upsertBudget", mutation)({
  args: {
    id: v.optional(v.id("budgets")),
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    category: v.string(),
    plannedCents: v.number(),
    programCode: v.optional(v.string()),
    accountId: v.optional(v.id("financialAccounts")),
    currency: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertBudgetPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertOperatingSubscription = authorizedMutation("financialHub:upsertOperatingSubscription", mutation)({
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
  handler: async (ctx, args) => upsertOperatingSubscriptionPortable(await toPortableMutationCtx(ctx), args),
});

export const removeOperatingSubscription = authorizedMutation("financialHub:removeOperatingSubscription", mutation)({
  args: { id: v.id("operatingSubscriptions"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => removeOperatingSubscriptionPortable(await toPortableMutationCtx(ctx), args),
});

export const removeBudget = authorizedMutation("financialHub:removeBudget", mutation)({
  args: { id: v.id("budgets"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => removeBudgetPortable(await toPortableMutationCtx(ctx), args),
});

// Budget grid: save a fiscal year's category lines atomically. Returns
// per-line errors (by input index) instead of writing anything when a line fails.
export const saveBudgetLines = authorizedMutation("financialHub:saveBudgetLines", mutation)({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    upserts: v.array(
      v.object({
        id: v.optional(v.id("budgets")),
        category: v.string(),
        plannedCents: v.number(),
        notes: v.optional(v.string()),
      }),
    ),
    removeIds: v.array(v.id("budgets")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveBudgetLinesPortable(await toPortableMutationCtx(ctx), args),
});

// Edit a single imported/synced transaction. Only the user-correctable fields
// (date, description, category, counterparty, amount, notes and the receipt
// document) are patchable; the account binding and external/source
// identifiers stay immutable. `receiptDocumentId: null` removes the receipt.
export const updateTransaction = authorizedMutation("financialHub:updateTransaction", mutation)({
  args: {
    id: v.id("financialTransactions"),
    patch: v.object({
      date: v.optional(v.string()),
      description: v.optional(v.string()),
      category: v.optional(v.string()),
      counterparty: v.optional(v.string()),
      amountCents: v.optional(v.number()),
      memo: v.optional(v.string()),
      receiptDocumentId: v.optional(v.union(v.id("documents"), v.null())),
      spendBudgetId: v.optional(v.union(v.id("spendBudgets"), v.null())),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateTransactionPortable(await toPortableMutationCtx(ctx), args),
});

// Bulk island on the transactions table: one change to many lines, returning
// the previous values so the client can undo with restoreTransactions.
export const bulkUpdateTransactions = authorizedMutation("financialHub:bulkUpdateTransactions", mutation)({
  args: {
    societyId: v.id("societies"),
    ids: v.array(v.id("financialTransactions")),
    patch: v.object({
      category: v.optional(v.string()),
      fundRestrictionId: v.optional(v.union(v.id("fundRestrictions"), v.null())),
      reviewed: v.optional(v.boolean()),
      spendBudgetId: v.optional(v.union(v.id("spendBudgets"), v.null())),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => bulkUpdateTransactionsPortable(await toPortableMutationCtx(ctx), args),
});

export const restoreTransactions = authorizedMutation("financialHub:restoreTransactions", mutation)({
  args: {
    societyId: v.id("societies"),
    rows: v.array(v.object({ id: v.id("financialTransactions"), values: v.any() })),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => restoreTransactionsPortable(await toPortableMutationCtx(ctx), args),
});

export const oauthUrl = authorizedQuery("financialHub:oauthUrl", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    await requireSocietyMembership(await toPortableQueryCtx(ctx), societyId);
    const p = providers.accounting();
    const society = await ctx.db.get(societyId);
    return {
      provider: p.id,
      live: p.live,
      demoAvailable: society?.demoMode === true,
    };
  },
});

export const markConnectionConnected = authorizedMutation("financialHub:markConnectionConnected", mutation)({
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
    if (args.provider !== "wave") throw new Error("This connection setup supports the Wave provider only.");
    if (!args.demo) operatorWaveBusinessId(String(args.societyId), args.externalBusinessId, providerDeploymentEnv("SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON"));
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

export const disconnect = authorizedMutation("financialHub:disconnect", mutation)({
  args: { connectionId: v.id("financialConnections"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => disconnectPortable(await toPortableMutationCtx(ctx), args),
});

export const removeDemoData = authorizedMutation("financialHub:removeDemoData", mutation)({
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
    const portable = await toPortableMutationCtx(ctx);
    for (const connection of demoConnections) await assertProviderConnectionRemovable(portable, String(societyId), String(connection._id));

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
    await getOwned(
      await toPortableMutationCtx(ctx),
      "financialConnections",
      args.connectionId,
      args.societyId,
    );
    await refreshFinancialProviderDataPortable(await toPortableMutationCtx(ctx), {
      societyId: String(args.societyId), connectionId: String(args.connectionId),
      accounts: args.accounts, transactions: args.transactions,
    });

    await ctx.db.patch(args.connectionId, {
      lastSyncAtISO: new Date().toISOString(),
      status: "connected",
      lastError: undefined,
    });
  },
});

export const importBrowserWaveTransactions = authorizedMutation("financialHub:importBrowserWaveTransactions", mutation)({
  args: {
    societyId: v.id("societies"),
    businessId: v.string(),
    profileKey: v.optional(v.string()),
    profileSocietyId: v.optional(v.string()),
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
    operatorWaveBusinessId(String(args.societyId), args.businessId, providerDeploymentEnv("SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON"));
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });
    return importBrowserWaveTransactionsPortable(await toPortableMutationCtx(ctx), {
      ...args, societyId: String(args.societyId),
      actingUserId: args.actingUserId ? String(args.actingUserId) : undefined,
    });
  },
});

export const sync = authorizedAction("financialHub:sync", action)({
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
    const businessId = allowDemo ? undefined : operatorWaveBusinessId(String(conn.societyId), conn.externalBusinessId, providerDeploymentEnv("SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON"));
    try {
      const accountResult = await waveListAccounts({ allowDemo, businessId });
      const transactionResult = await waveListTransactions({ allowDemo, businessId });
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

export const getConnection = authorizedQuery("financialHub:getConnection", query)({
  args: { id: v.id("financialConnections") },
  returns: v.any(),
  handler: async (ctx, args) => getConnectionPortable(await toPortableQueryCtx(ctx), args),
});

export const _markSyncError = internalMutation({
  args: { connectionId: v.id("financialConnections"), error: v.string() },
  returns: v.any(),
  handler: async (ctx, { connectionId, error }) => {
    const portableCtx = await toPortableMutationCtx(ctx);
    const connection = await portableCtx.db.get(connectionId, "financialConnections");
    if (!connection) throw new Error("financialConnections not found.");
    await requireSocietyMembership(portableCtx, String(connection.societyId));
    await getOwned(
      portableCtx,
      "financialConnections",
      connectionId,
      String(connection.societyId),
    );
    await ctx.db.patch(connectionId, { status: "error", lastError: error });
  },
});

// A small derived query for the dashboard — balances by purpose/category.
// Prefers balances computed from posted journal lines (the durable double-entry
// ledger) where an account has any, falling back to the imported balanceCents.
export const summary = authorizedQuery("financialHub:summary", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => summaryPortable(await toPortableQueryCtx(ctx), args),
});

// Import bank / credit-card statement rows (parsed from CSV client-side) into an
// existing account. Wave's public API can't return ledger rows, so CSV import is
// the documented way to get real history in. Deduped per account by externalId
// (falling back to a deterministic date+amount+index key) so re-importing the
// same statement doesn't double-post.
export const importBankCsvTransactions = authorizedMutation("financialHub:importBankCsvTransactions", mutation)({
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
    const account = await getOwned(
      await toPortableMutationCtx(ctx),
      "financialAccounts",
      args.accountId,
      args.societyId,
    );
    const existing = await ctx.db
      .query("financialTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const seen = new Set(
      existing.filter((t) => t.accountId === args.accountId).map((t) => t.externalId),
    );
    // Categorisation rules run on every new uncategorised line.
    const rules = (await ctx.db
      .query("transactionRules")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect()) as any[];
    // Rules pointing at a removed account or an archived fund are skipped, as in "Apply rules".
    const [ruleAccounts, ruleFunds] = await Promise.all([
      ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
      ctx.db.query("fundRestrictions").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
    ]);
    const skipRules = invalidRuleIds(rules, ruleReferenceIndex(ruleAccounts, ruleFunds));
    // Payee rename rules store the display name as the counterparty.
    const payeeAliases = (await ctx.db
      .query("payeeAliases")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect()) as any[];
    const appliedAtISO = new Date().toISOString();
    const ruleBatch = `import-${appliedAtISO}`;
    let categorized = 0;

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
      const ruled = rulePatchForTransaction(rules, { ...row, accountId: args.accountId }, appliedAtISO, ruleBatch, skipRules);
      if (ruled) categorized += 1;
      await ctx.db.insert("financialTransactions", {
        societyId: args.societyId,
        connectionId: account.connectionId,
        accountId: args.accountId,
        externalId,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
        category: row.category,
        counterparty: aliasedCounterparty(payeeAliases, row) ?? row.counterparty,
        ...(ruled?.patch ?? {}),
      });
      seen.add(externalId);
      inserted += 1;
    }
    return { inserted, skipped, total: args.rows.length, categorized };
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
