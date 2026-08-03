/**
 * Backfill tenant ownership for every native Convex storage reference.
 *
 * Run with:
 *   node scripts/convex-maintenance.mjs storageOwnershipBackfill:run
 *
 * The mutation is idempotent. A storage id referenced by more than one society,
 * or one that conflicts with an existing claim, is reported and left unchanged.
 */

import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { assertMaintenanceToken, serviceTokenValidator } from "./lib/serviceAuth";

type StorageReference = {
  storageId: Id<"_storage">;
  societyId: Id<"societies">;
  source: string;
};

const resultValidator = v.object({
  scannedReferences: v.number(),
  claimed: v.number(),
  existing: v.number(),
  conflicts: v.array(v.object({
    storageId: v.string(),
    societyIds: v.array(v.string()),
    sources: v.array(v.string()),
  })),
});

export const run = mutation({
  args: { serviceToken: serviceTokenValidator },
  returns: resultValidator,
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    const [societies, documents, assets, inventoryItems, existingOwnership] = await Promise.all([
      ctx.db.query("societies").collect(),
      ctx.db.query("documents").collect(),
      ctx.db.query("assets").collect(),
      ctx.db.query("inventoryItems").collect(),
      ctx.db.query("storageOwnership").collect(),
    ]);

    const references: StorageReference[] = [];
    for (const society of societies) {
      if (society.logoStorageId) {
        references.push({ storageId: society.logoStorageId, societyId: society._id, source: `societies:${society._id}:logoStorageId` });
      }
      if (society.logoDarkStorageId) {
        references.push({ storageId: society.logoDarkStorageId, societyId: society._id, source: `societies:${society._id}:logoDarkStorageId` });
      }
      if (society.letterheadStorageId) {
        references.push({ storageId: society.letterheadStorageId, societyId: society._id, source: `societies:${society._id}:letterheadStorageId` });
      }
    }
    for (const document of documents) {
      if (document.storageId) {
        references.push({ storageId: document.storageId, societyId: document.societyId, source: `documents:${document._id}:storageId` });
      }
    }
    for (const asset of assets) {
      if (asset.imageStorageId) {
        references.push({ storageId: asset.imageStorageId, societyId: asset.societyId, source: `assets:${asset._id}:imageStorageId` });
      }
    }
    for (const item of inventoryItems) {
      if (item.imageStorageId) {
        references.push({ storageId: item.imageStorageId, societyId: item.societyId, source: `inventoryItems:${item._id}:imageStorageId` });
      }
    }

    const byStorage = new Map<string, StorageReference[]>();
    for (const reference of references) {
      const key = String(reference.storageId);
      const group = byStorage.get(key) ?? [];
      group.push(reference);
      byStorage.set(key, group);
    }
    const existingByStorage = new Map<string, typeof existingOwnership>();
    for (const ownership of existingOwnership) {
      const key = String(ownership.storageId);
      const group = existingByStorage.get(key) ?? [];
      group.push(ownership);
      existingByStorage.set(key, group);
    }

    let claimed = 0;
    let existing = 0;
    const conflicts: Array<{ storageId: string; societyIds: string[]; sources: string[] }> = [];
    for (const [storageId, group] of byStorage) {
      const ownershipRows = existingByStorage.get(storageId) ?? [];
      const societyIds = new Set([
        ...group.map((reference) => String(reference.societyId)),
        ...ownershipRows.map((ownership) => String(ownership.societyId)),
      ]);
      if (societyIds.size !== 1) {
        conflicts.push({
          storageId,
          societyIds: [...societyIds].sort(),
          sources: group.map((reference) => reference.source).sort(),
        });
        continue;
      }
      if (ownershipRows.length > 0) {
        existing += 1;
        continue;
      }
      const reference = group[0];
      await ctx.db.insert("storageOwnership", {
        storageId: reference.storageId,
        societyId: reference.societyId,
        createdAtISO: new Date().toISOString(),
      });
      claimed += 1;
    }

    return {
      scannedReferences: references.length,
      claimed,
      existing,
      conflicts: conflicts.sort((left, right) => left.storageId.localeCompare(right.storageId)),
    };
  },
});
