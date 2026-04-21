// @ts-nocheck
import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { waveFetchSnapshot, waveHealthCheck, waveInvoicePaymentProbe } from "./providers/waveData";
import { redactWaveDiagnostic, waveEnvironmentStatus } from "./providers/waveDiagnostics";

const resourceValidator = v.object({
  resourceType: v.string(),
  externalId: v.optional(v.string()),
  label: v.string(),
  secondaryLabel: v.optional(v.string()),
  typeValue: v.optional(v.string()),
  subtypeValue: v.optional(v.string()),
  status: v.optional(v.string()),
  currencyCode: v.optional(v.string()),
  amountValue: v.optional(v.string()),
  dateValue: v.optional(v.string()),
  searchText: v.string(),
  rawJson: v.string(),
});

const structureValidator = v.object({
  typeName: v.string(),
  kind: v.string(),
  fieldCount: v.number(),
  fieldsJson: v.string(),
  rawJson: v.string(),
});

export const summary = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const snapshot = await latestSnapshot(ctx, societyId);
    if (!snapshot) return null;
    return {
      ...snapshot,
      resourceCounts: parseJson(snapshot.resourceCountsJson, {}),
    };
  },
});

export const resources = query({
  args: {
    societyId: v.id("societies"),
    resourceType: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { societyId, resourceType, search, limit }) => {
    const snapshot = await latestSnapshot(ctx, societyId);
    if (!snapshot) return [];
    const rows = await ctx.db
      .query("waveCacheResources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
      .collect();
    const [counterpartyStats, categoryStats] = await Promise.all([
      linkedTransactionStatsByExternalId(ctx, societyId),
      linkedCategoryStatsByAccountExternalId(ctx, societyId, rows),
    ]);
    const needle = search?.trim().toLowerCase();
    return rows
      .filter((row) => !resourceType || row.resourceType === resourceType)
      .filter((row) => !needle || row.searchText.includes(needle))
      .sort((a, b) => `${a.resourceType}:${a.label}`.localeCompare(`${b.resourceType}:${b.label}`))
      .slice(0, limit ?? 500)
      .map(({ rawJson, ...row }) => ({
        ...row,
        ...counterpartyStats.get(row.externalId ?? ""),
        ...categoryStats.get(row.externalId ?? ""),
        hasRawJson: Boolean(rawJson),
      }));
  },
});

export const resource = query({
  args: { id: v.id("waveCacheResources") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    const snapshotRows = await ctx.db
      .query("waveCacheResources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", row.snapshotId))
      .collect();
    const [counterpartyStats, categoryStats] = await Promise.all([
      linkedTransactionStatsByExternalId(ctx, row.societyId),
      linkedCategoryStatsByAccountExternalId(ctx, row.societyId, snapshotRows),
    ]);
    return {
      ...row,
      ...counterpartyStats.get(row.externalId ?? ""),
      ...categoryStats.get(row.externalId ?? ""),
      raw: parseJson(row.rawJson, null),
    };
  },
});

export const resourceByExternalId = query({
  args: {
    societyId: v.id("societies"),
    externalId: v.string(),
    resourceType: v.optional(v.string()),
  },
  handler: async (ctx, { societyId, externalId, resourceType }) => {
    const snapshot = await latestSnapshot(ctx, societyId);
    if (!snapshot) return null;
    const rows = await ctx.db
      .query("waveCacheResources")
      .withIndex("by_society_external", (q) => q.eq("societyId", societyId).eq("externalId", externalId))
      .collect();
    const row = rows.find((candidate) => candidate.snapshotId === snapshot._id && (!resourceType || candidate.resourceType === resourceType));
    if (!row) return null;
    const snapshotRows = await ctx.db
      .query("waveCacheResources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
      .collect();
    const [counterpartyStats, categoryStats] = await Promise.all([
      linkedTransactionStatsByExternalId(ctx, societyId),
      linkedCategoryStatsByAccountExternalId(ctx, societyId, snapshotRows),
    ]);
    return {
      ...row,
      ...counterpartyStats.get(row.externalId ?? ""),
      ...categoryStats.get(row.externalId ?? ""),
      raw: parseJson(row.rawJson, null),
    };
  },
});

export const structures = query({
  args: {
    societyId: v.id("societies"),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { societyId, search, limit }) => {
    const snapshot = await latestSnapshot(ctx, societyId);
    if (!snapshot) return [];
    const needle = search?.trim().toLowerCase();
    const rows = await ctx.db
      .query("waveCacheStructures")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
      .collect();
    return rows
      .filter((row) => !needle || row.typeName.toLowerCase().includes(needle) || row.kind.toLowerCase().includes(needle))
      .sort((a, b) => a.typeName.localeCompare(b.typeName))
      .slice(0, limit ?? 100)
      .map((row) => ({
        ...row,
        fields: parseJson(row.fieldsJson, []),
      }));
  },
});

export const sync = action({
  args: {
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("financialConnections")),
    businessId: v.optional(v.string()),
  },
  handler: async (ctx, { societyId, connectionId, businessId }) => {
    const connection = connectionId
      ? await ctx.runQuery(api.financialHub.getConnection, { id: connectionId })
      : await findWaveConnection(ctx, societyId);
    const society = await ctx.runQuery(api.society.getById, { id: societyId });
    const allowDemo = connection?.demo === true && society?.demoMode === true;
    try {
      const snapshot = await waveFetchSnapshot({
        businessId: businessId ?? connection?.externalBusinessId,
        allowDemo,
      });
      const snapshotId = await ctx.runMutation(internal.waveCache._replaceSnapshot, {
        societyId,
        connectionId: connection?._id,
        ...snapshot,
      });
      await ctx.runMutation(api.notifications.create, {
        societyId,
        kind: "general",
        severity: "success",
        title: `Cached Wave data for ${snapshot.businessName}`,
        body: `${snapshot.resources.length} resources and ${snapshot.structures.length} schema structures stored locally.`,
        linkHref: "/financials",
      });
      return {
        snapshotId,
        businessName: snapshot.businessName,
        resourceCounts: snapshot.resourceCounts,
        resourceCount: snapshot.resources.length,
        structureCount: snapshot.structures.length,
        fetchedAtISO: snapshot.fetchedAtISO,
      };
    } catch (err: any) {
      throw new Error(redactWaveDiagnostic(err?.message ?? "Wave cache refresh failed.", [
        businessId,
        connection?.externalBusinessId,
      ]));
    }
  },
});

export const healthCheck = action({
  args: {
    businessId: v.optional(v.string()),
  },
  handler: async (_ctx, { businessId }) => {
    try {
      return await waveHealthCheck({ businessId });
    } catch (err: any) {
      const env = waveEnvironmentStatus();
      const live = env.some((row) => row.name === "WAVE_ACCESS_TOKEN" && row.present);
      return {
        provider: "wave",
        mode: live ? "live" : "not_configured",
        ok: false,
        status: "fail",
        checkedAtISO: new Date().toISOString(),
        env,
        steps: [
          {
            id: "health-check",
            label: "Health check",
            status: "fail",
            message: redactWaveDiagnostic(err?.message ?? "Wave health check failed.", [businessId]),
          },
        ],
      };
    }
  },
});

export const invoicePaymentProbe = action({
  args: {
    businessId: v.optional(v.string()),
    allAccessibleBusinesses: v.optional(v.boolean()),
    maxInvoices: v.optional(v.number()),
    maxPayments: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    try {
      return await waveInvoicePaymentProbe(args);
    } catch (err: any) {
      return {
        provider: "wave",
        ok: false,
        error: redactWaveDiagnostic(err?.message ?? "Wave invoice payment probe failed.", [args.businessId]),
      };
    }
  },
});

export const _replaceSnapshot = internalMutation({
  args: {
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(),
    businessId: v.string(),
    businessName: v.string(),
    currencyCode: v.optional(v.string()),
    fetchedAtISO: v.string(),
    resourceCounts: v.record(v.string(), v.number()),
    resources: v.array(resourceValidator),
    structures: v.array(structureValidator),
  },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query("waveCacheSnapshots")
      .withIndex("by_society_provider", (q) => q.eq("societyId", args.societyId).eq("provider", args.provider))
      .collect();
    for (const snapshot of previous) {
      const resources = await ctx.db
        .query("waveCacheResources")
        .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
        .collect();
      for (const row of resources) await ctx.db.delete(row._id);
      const structures = await ctx.db
        .query("waveCacheStructures")
        .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
        .collect();
      for (const row of structures) await ctx.db.delete(row._id);
      await ctx.db.delete(snapshot._id);
    }

    const resourceTypes = Object.keys(args.resourceCounts).sort();
    const structureTypes = args.structures.map((row) => row.typeName).sort();
    const snapshotId = await ctx.db.insert("waveCacheSnapshots", {
      societyId: args.societyId,
      connectionId: args.connectionId,
      provider: args.provider,
      businessId: args.businessId,
      businessName: args.businessName,
      currencyCode: args.currencyCode,
      fetchedAtISO: args.fetchedAtISO,
      resourceCountsJson: JSON.stringify(args.resourceCounts),
      resourceTypes,
      structureTypes,
      status: "complete",
    });

    for (const row of args.resources) {
      await ctx.db.insert("waveCacheResources", {
        societyId: args.societyId,
        snapshotId,
        connectionId: args.connectionId,
        provider: args.provider,
        businessId: args.businessId,
        ...row,
        fetchedAtISO: args.fetchedAtISO,
      });
    }

    for (const row of args.structures) {
      await ctx.db.insert("waveCacheStructures", {
        societyId: args.societyId,
        snapshotId,
        connectionId: args.connectionId,
        provider: args.provider,
        businessId: args.businessId,
        ...row,
        fetchedAtISO: args.fetchedAtISO,
      });
    }

    return snapshotId;
  },
});

async function latestSnapshot(ctx: any, societyId: string) {
  const rows = await ctx.db
    .query("waveCacheSnapshots")
    .withIndex("by_society_provider", (q) => q.eq("societyId", societyId).eq("provider", "wave"))
    .order("desc")
    .take(1);
  return rows[0] ?? null;
}

async function findWaveConnection(ctx: any, societyId: string) {
  const connections = await ctx.runQuery(api.financialHub.connections, { societyId });
  return (
    connections.find((row: any) => row.provider === "wave" && row.status === "connected") ??
    connections.find((row: any) => row.provider === "wave") ??
    null
  );
}

function parseJson(value: string, fallback: any) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function linkedTransactionStatsByExternalId(ctx: any, societyId: string) {
  const rows = await ctx.db
    .query("financialTransactions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const stats = new Map<string, { linkedTransactionCount: number; linkedTransactionTotalCents: number }>();
  for (const transaction of rows) {
    if (!transaction.counterpartyExternalId) continue;
    const current = stats.get(transaction.counterpartyExternalId) ?? {
      linkedTransactionCount: 0,
      linkedTransactionTotalCents: 0,
    };
    current.linkedTransactionCount += 1;
    current.linkedTransactionTotalCents += transaction.amountCents;
    stats.set(transaction.counterpartyExternalId, current);
  }
  return stats;
}

async function linkedCategoryStatsByAccountExternalId(ctx: any, societyId: string, resources: any[]) {
  const rows = await ctx.db
    .query("financialTransactions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const accountIdsByLabel = new Map<string, string[]>();
  for (const resource of resources) {
    if (resource.resourceType !== "account" || !resource.externalId) continue;
    const label = normalizeCategoryLabel(resource.label);
    if (!label) continue;
    const ids = accountIdsByLabel.get(label) ?? [];
    ids.push(resource.externalId);
    accountIdsByLabel.set(label, ids);
  }

  const stats = new Map<string, { linkedCategoryTransactionCount: number; linkedCategoryTransactionTotalCents: number }>();
  for (const transaction of rows) {
    const matchedExternalIds = new Set<string>();
    if (transaction.categoryAccountExternalId) {
      matchedExternalIds.add(transaction.categoryAccountExternalId);
    }
    const categoryMatches = accountIdsByLabel.get(normalizeCategoryLabel(transaction.category)) ?? [];
    for (const externalId of categoryMatches) matchedExternalIds.add(externalId);

    for (const externalId of matchedExternalIds) {
      const current = stats.get(externalId) ?? {
        linkedCategoryTransactionCount: 0,
        linkedCategoryTransactionTotalCents: 0,
      };
      current.linkedCategoryTransactionCount += 1;
      current.linkedCategoryTransactionTotalCents += transaction.amountCents;
      stats.set(externalId, current);
    }
  }
  return stats;
}

function normalizeCategoryLabel(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}
