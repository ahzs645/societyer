// @ts-nocheck
import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { waveFetchSnapshot, waveHealthCheck } from "./providers/waveData";
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
    const needle = search?.trim().toLowerCase();
    return rows
      .filter((row) => !resourceType || row.resourceType === resourceType)
      .filter((row) => !needle || row.searchText.includes(needle))
      .sort((a, b) => `${a.resourceType}:${a.label}`.localeCompare(`${b.resourceType}:${b.label}`))
      .slice(0, limit ?? 500)
      .map(({ rawJson, ...row }) => ({
        ...row,
        hasRawJson: Boolean(rawJson),
      }));
  },
});

export const resource = query({
  args: { id: v.id("waveCacheResources") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    return {
      ...row,
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
    try {
      const snapshot = await waveFetchSnapshot({
        businessId: businessId ?? connection?.externalBusinessId,
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
