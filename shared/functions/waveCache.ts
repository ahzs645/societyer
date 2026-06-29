/**
 * PORTABLE FUNCTIONS: the Wave cache read domain
 * (summary / resources / resource / resourceByExternalId / structures).
 *
 * Only the pure `ctx.db` query handlers live here. The Wave sync surface
 * (the `sync` / `healthCheck` / `invoicePaymentProbe` actions and the
 * `_replaceSnapshot` internal mutation) stays on Convex because it fetches from
 * the Wave API. Each handler reads exclusively through the portable `ctx.db`
 * contract and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle. The snapshot/stat helpers are pure (`ctx.db`-only) and are
 * shared by these handlers.
 */

import type { PortableQueryCtx } from "../portable/ctx";

export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const snapshot = await latestSnapshot(ctx, societyId);
  if (!snapshot) return null;
  return {
    ...snapshot,
    resourceCounts: parseJson(snapshot.resourceCountsJson, {}),
  };
}

export async function resourcesPortable(
  ctx: PortableQueryCtx,
  { societyId, resourceType, search, limit }: { societyId: string; resourceType?: string; search?: string; limit?: number },
) {
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
}

export async function resourcePortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const row = await ctx.db.get(id);
  if (!row) return null;
  const snapshotRows = await ctx.db
    .query("waveCacheResources")
    .withIndex("by_snapshot", (q) => q.eq("snapshotId", row.snapshotId))
    .collect();
  const [counterpartyStats, categoryStats] = await Promise.all([
    linkedTransactionStatsByExternalId(ctx, String(row.societyId)),
    linkedCategoryStatsByAccountExternalId(ctx, String(row.societyId), snapshotRows),
  ]);
  return {
    ...row,
    ...counterpartyStats.get(row.externalId ?? ""),
    ...categoryStats.get(row.externalId ?? ""),
    raw: parseJson(row.rawJson, null),
  };
}

export async function resourceByExternalIdPortable(
  ctx: PortableQueryCtx,
  { societyId, externalId, resourceType }: { societyId: string; externalId: string; resourceType?: string },
) {
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
}

export async function structuresPortable(
  ctx: PortableQueryCtx,
  { societyId, search, limit }: { societyId: string; search?: string; limit?: number },
) {
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
}

async function latestSnapshot(ctx: PortableQueryCtx, societyId: string) {
  const rows = await ctx.db
    .query("waveCacheSnapshots")
    .withIndex("by_society_provider", (q) => q.eq("societyId", societyId).eq("provider", "wave"))
    .order("desc")
    .take(1);
  return rows[0] ?? null;
}

function parseJson(value: string, fallback: any) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function linkedTransactionStatsByExternalId(ctx: PortableQueryCtx, societyId: string) {
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

async function linkedCategoryStatsByAccountExternalId(ctx: PortableQueryCtx, societyId: string, resources: any[]) {
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
    } else {
      const categoryMatches = accountIdsByLabel.get(normalizeCategoryLabel(transaction.category)) ?? [];
      for (const externalId of categoryMatches) matchedExternalIds.add(externalId);
    }

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
