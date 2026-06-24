import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";

function movementSign(type: string, direction: "from" | "to") {
  if (type === "reserve" || type === "unreserve") return 0;
  if (direction === "from") return -1;
  if (type === "issue" || type === "consume" || type === "dispose") return -1;
  return 1;
}

async function findOrCreateLocation(
  ctx: any,
  args: {
    societyId: any;
    name: string;
    locationType?: string;
    sourceSystem?: string;
  },
) {
  const name = args.name.trim() || "Inventory";
  const existing = await ctx.db
    .query("inventoryLocations")
    .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
    .collect();
  const match = existing.find((row: any) => row.name.toLowerCase() === name.toLowerCase());
  if (match) return match._id;
  const now = new Date().toISOString();
  return ctx.db.insert("inventoryLocations", {
    societyId: args.societyId,
    name,
    locationType: args.locationType ?? "facility",
    active: true,
    sourceSystem: args.sourceSystem ?? "manual",
    createdAtISO: now,
    updatedAtISO: now,
  });
}

async function balanceFor(
  ctx: any,
  args: {
    inventoryItemId: any;
    inventoryLotId?: any;
    locationId: any;
  },
) {
  const rows = await ctx.db
    .query("inventoryBalances")
    .withIndex("by_item_location", (q: any) =>
      q.eq("inventoryItemId", args.inventoryItemId).eq("locationId", args.locationId),
    )
    .collect();
  return rows.find((row: any) => String(row.inventoryLotId ?? "") === String(args.inventoryLotId ?? ""));
}

async function applyBalanceDelta(
  ctx: any,
  args: {
    societyId: any;
    inventoryItemId: any;
    inventoryLotId?: any;
    locationId: any;
    delta: number;
    movementId: any;
    counted?: boolean;
  },
) {
  if (args.delta === 0) return;
  const now = new Date().toISOString();
  const existing = await balanceFor(ctx, args);
  if (existing) {
    const quantityOnHand = existing.quantityOnHand + args.delta;
    const quantityReserved = existing.quantityReserved ?? 0;
    await ctx.db.patch(existing._id, {
      quantityOnHand,
      quantityAvailable: quantityOnHand - quantityReserved,
      lastMovementId: args.movementId,
      ...(args.counted ? { lastCountedAtISO: now } : {}),
      updatedAtISO: now,
    });
    return;
  }
  await ctx.db.insert("inventoryBalances", {
    societyId: args.societyId,
    inventoryItemId: args.inventoryItemId,
    inventoryLotId: args.inventoryLotId,
    locationId: args.locationId,
    quantityOnHand: args.delta,
    quantityReserved: 0,
    quantityAvailable: args.delta,
    lastMovementId: args.movementId,
    ...(args.counted ? { lastCountedAtISO: now } : {}),
    createdAtISO: now,
    updatedAtISO: now,
  });
}

async function postMovementEffects(ctx: any, movement: any) {
  if (movement.status !== "posted") return;
  if (movement.fromLocationId) {
    await applyBalanceDelta(ctx, {
      societyId: movement.societyId,
      inventoryItemId: movement.inventoryItemId,
      inventoryLotId: movement.inventoryLotId,
      locationId: movement.fromLocationId,
      delta: movement.quantity * movementSign(movement.movementType, "from"),
      movementId: movement._id,
      counted: movement.movementType === "count",
    });
  }
  if (movement.toLocationId) {
    await applyBalanceDelta(ctx, {
      societyId: movement.societyId,
      inventoryItemId: movement.inventoryItemId,
      inventoryLotId: movement.inventoryLotId,
      locationId: movement.toLocationId,
      delta: movement.quantity * movementSign(movement.movementType, "to"),
      movementId: movement._id,
      counted: movement.movementType === "count",
    });
  }
}

export const connections = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("inventoryConnections")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect(),
});

export const items = query({
  args: { societyId: v.id("societies"), itemType: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId, itemType }) => {
    const rows = await (itemType
      ? ctx.db
          .query("inventoryItems")
          .withIndex("by_society_type", (q: any) => q.eq("societyId", societyId).eq("itemType", itemType))
          .collect()
      : ctx.db
          .query("inventoryItems")
          .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
          .collect());
    const sorted = rows.sort((a: any, b: any) => a.name.localeCompare(b.name));
    return Promise.all(
      sorted.map(async (row: any) => ({
        ...row,
        imageUrl: row.imageStorageId ? (await ctx.storage.getUrl(row.imageStorageId)) ?? row.imageUrl : row.imageUrl,
      })),
    );
  },
});

export const locations = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("inventoryLocations")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    return rows.sort((a: any, b: any) => a.name.localeCompare(b.name));
  },
});

export const balances = query({
  args: { societyId: v.id("societies"), inventoryItemId: v.optional(v.id("inventoryItems")) },
  returns: v.any(),
  handler: async (ctx, { societyId, inventoryItemId }) => {
    const rows = inventoryItemId
      ? await ctx.db
          .query("inventoryBalances")
          .withIndex("by_item", (q: any) => q.eq("inventoryItemId", inventoryItemId))
          .collect()
      : await ctx.db
          .query("inventoryBalances")
          .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
          .collect();
    return rows;
  },
});

export const lots = query({
  args: { societyId: v.id("societies"), inventoryItemId: v.optional(v.id("inventoryItems")) },
  returns: v.any(),
  handler: async (ctx, { societyId, inventoryItemId }) => {
    const rows = inventoryItemId
      ? await ctx.db
          .query("inventoryLots")
          .withIndex("by_item", (q: any) => q.eq("inventoryItemId", inventoryItemId))
          .collect()
      : await ctx.db
          .query("inventoryLots")
          .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
          .collect();
    return rows
      .filter((row: any) => row.societyId === societyId)
      .sort((a: any, b: any) => String(a.expiresAt ?? "9999").localeCompare(String(b.expiresAt ?? "9999")));
  },
});

export const stockMovements = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { societyId, limit }) =>
    ctx.db
      .query("stockMovements")
      .withIndex("by_society_date", (q: any) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 100),
});

export const receiptLinks = query({
  args: { societyId: v.id("societies"), inventoryItemId: v.optional(v.id("inventoryItems")) },
  returns: v.any(),
  handler: async (ctx, { societyId, inventoryItemId }) => {
    const rows = inventoryItemId
      ? await ctx.db
          .query("assetReceiptLinks")
          .withIndex("by_inventory_item", (q: any) => q.eq("inventoryItemId", inventoryItemId))
          .collect()
      : await ctx.db
          .query("assetReceiptLinks")
          .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
          .collect();
    const scoped = rows.filter((row: any) => row.societyId === societyId);
    const documents = await Promise.all(scoped.map((row: any) => (row.receiptDocumentId ? ctx.db.get(row.receiptDocumentId) : null)));
    const assets = await Promise.all(scoped.map((row: any) => (row.assetId ? ctx.db.get(row.assetId) : null)));
    const inventoryItems = await Promise.all(scoped.map((row: any) => (row.inventoryItemId ? ctx.db.get(row.inventoryItemId) : null)));
    return scoped.map((row: any, index: number) => ({
      ...row,
      receiptDocument: documents[index],
      asset: assets[index],
      inventoryItem: inventoryItems[index],
    }));
  },
});

export const counts = query({
  args: { societyId: v.id("societies"), status: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId, status }) => {
    const rows = await (status
      ? ctx.db
          .query("inventoryCounts")
          .withIndex("by_society_status", (q: any) => q.eq("societyId", societyId).eq("status", status))
          .collect()
      : ctx.db
          .query("inventoryCounts")
          .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
          .collect());
    const sorted = rows.sort((a: any, b: any) => b.startedAtISO.localeCompare(a.startedAtISO));
    const lines = await Promise.all(
      sorted.map((count: any) =>
        ctx.db
          .query("inventoryCountLines")
          .withIndex("by_count", (q: any) => q.eq("inventoryCountId", count._id))
          .collect(),
      ),
    );
    return sorted.map((count: any, index: number) => ({ ...count, lines: lines[index] }));
  },
});

export const upsertConnection = mutation({
  args: {
    id: v.optional(v.id("inventoryConnections")),
    societyId: v.id("societies"),
    provider: v.string(),
    displayName: v.string(),
    status: v.string(),
    externalOrganizationId: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    settingsJson: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const { id, ...payload } = args;
    if (id) {
      await ctx.db.patch(id, { ...payload, updatedAtISO: now });
      return id;
    }
    return ctx.db.insert("inventoryConnections", {
      ...payload,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const upsertItem = mutation({
  args: {
    id: v.optional(v.id("inventoryItems")),
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    sku: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    itemType: v.string(),
    unitOfMeasure: v.string(),
    defaultCostCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    trackSerial: v.optional(v.boolean()),
    trackLot: v.optional(v.boolean()),
    trackExpiry: v.optional(v.boolean()),
    reorderPoint: v.optional(v.number()),
    status: v.optional(v.string()),
    assetId: v.optional(v.id("assets")),
    imageStorageId: v.optional(v.id("_storage")),
    imageUrl: v.optional(v.string()),
    clearImage: v.optional(v.boolean()),
    externalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    rawJson: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const { id, clearImage, ...payload } = args;
    const row: any = {
      ...payload,
      currency: payload.currency ?? "CAD",
      trackSerial: payload.trackSerial ?? false,
      trackLot: payload.trackLot ?? false,
      trackExpiry: payload.trackExpiry ?? false,
      status: payload.status ?? "active",
      sourceSystem: payload.sourceSystem ?? "manual",
      updatedAtISO: now,
    };
    // Convex patch ignores undefined args, so clearing an image needs an explicit signal.
    if (clearImage) {
      row.imageStorageId = undefined;
      row.imageUrl = undefined;
    }
    if (id) {
      await ctx.db.patch(id, row);
      return id;
    }
    return ctx.db.insert("inventoryItems", { ...row, createdAtISO: now });
  },
});

export const upsertLocation = mutation({
  args: {
    id: v.optional(v.id("inventoryLocations")),
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    name: v.string(),
    code: v.optional(v.string()),
    locationType: v.string(),
    parentLocationId: v.optional(v.id("inventoryLocations")),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    active: v.optional(v.boolean()),
    externalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    rawJson: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const { id, ...payload } = args;
    // A location can't be its own parent.
    if (id && payload.parentLocationId && String(payload.parentLocationId) === String(id)) {
      throw new Error("A location cannot be its own parent.");
    }
    const row = {
      ...payload,
      active: payload.active ?? true,
      sourceSystem: payload.sourceSystem ?? "manual",
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, row);
      return id;
    }
    return ctx.db.insert("inventoryLocations", { ...row, createdAtISO: now });
  },
});

export const deleteLocation = mutation({
  args: { id: v.id("inventoryLocations") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const location = await ctx.db.get(id);
    if (!location) return { deleted: false };
    // Refuse to delete a location that still holds stock — that would orphan
    // the balance and break the "where is this item" answer.
    const balances = await ctx.db
      .query("inventoryBalances")
      .withIndex("by_location", (q: any) => q.eq("locationId", id))
      .collect();
    if (balances.some((row: any) => (row.quantityOnHand ?? 0) !== 0)) {
      throw new Error("Move or zero out this location's stock before deleting it.");
    }
    const children = await ctx.db
      .query("inventoryLocations")
      .withIndex("by_parent", (q: any) => q.eq("parentLocationId", id))
      .collect();
    if (children.length > 0) {
      throw new Error("Re-parent or delete the locations nested inside this one first.");
    }
    // Clean up any empty balance rows left behind.
    for (const row of balances) await ctx.db.delete(row._id);
    await ctx.db.delete(id);
    return { deleted: true };
  },
});

export const deleteItem = mutation({
  args: { id: v.id("inventoryItems") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const item = await ctx.db.get(id);
    if (!item) return { deleted: false };
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_item_date", (q: any) => q.eq("inventoryItemId", id))
      .collect();
    if (movements.length > 0) {
      throw new Error("This item has stock movement history. Archive it instead of deleting.");
    }
    const balances = await ctx.db
      .query("inventoryBalances")
      .withIndex("by_item", (q: any) => q.eq("inventoryItemId", id))
      .collect();
    for (const row of balances) await ctx.db.delete(row._id);
    const lots = await ctx.db
      .query("inventoryLots")
      .withIndex("by_item", (q: any) => q.eq("inventoryItemId", id))
      .collect();
    for (const row of lots) await ctx.db.delete(row._id);
    await ctx.db.delete(id);
    return { deleted: true };
  },
});

export const upsertLot = mutation({
  args: {
    id: v.optional(v.id("inventoryLots")),
    societyId: v.id("societies"),
    inventoryItemId: v.id("inventoryItems"),
    lotNumber: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    manufacturedAt: v.optional(v.string()),
    condition: v.optional(v.string()),
    status: v.optional(v.string()),
    assetId: v.optional(v.id("assets")),
    externalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    rawJson: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const { id, ...payload } = args;
    const row = {
      ...payload,
      status: payload.status ?? "active",
      sourceSystem: payload.sourceSystem ?? "manual",
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, row);
      return id;
    }
    return ctx.db.insert("inventoryLots", { ...row, createdAtISO: now });
  },
});

export const deleteLot = mutation({
  args: { id: v.id("inventoryLots") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_lot", (q: any) => q.eq("inventoryLotId", id))
      .collect();
    if (movements.length > 0) {
      throw new Error("This lot has stock movement history and can't be deleted.");
    }
    await ctx.db.delete(id);
    return { deleted: true };
  },
});

// Start an in-app physical count. Seeds count lines from the current posted
// balances for the chosen scope so a counter can walk a location (or the whole
// catalog) and record what they actually find.
export const createCount = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    locationId: v.optional(v.id("inventoryLocations")),
    itemType: v.optional(v.string()),
    reviewerName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const scope = args.locationId
      ? "location"
      : args.itemType
        ? args.itemType
        : "all";
    const countId = await ctx.db.insert("inventoryCounts", {
      societyId: args.societyId,
      title: args.title,
      status: "open",
      startedAtISO: now,
      reviewerName: args.reviewerName,
      locationId: args.locationId,
      scope,
      sourceDocumentIds: [],
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });

    const itemsById = new Map<string, any>();
    for (const item of await ctx.db
      .query("inventoryItems")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect()) {
      itemsById.set(String(item._id), item);
    }
    const balances = await ctx.db
      .query("inventoryBalances")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect();
    let lines = 0;
    for (const balance of balances) {
      if (args.locationId && String(balance.locationId) !== String(args.locationId)) continue;
      const item = itemsById.get(String(balance.inventoryItemId));
      if (!item) continue;
      if (args.itemType && item.itemType !== args.itemType) continue;
      await ctx.db.insert("inventoryCountLines", {
        societyId: args.societyId,
        inventoryCountId: countId,
        inventoryItemId: balance.inventoryItemId,
        inventoryLotId: balance.inventoryLotId,
        locationId: balance.locationId,
        expectedQuantity: balance.quantityOnHand ?? 0,
        status: "pending",
        createdAtISO: now,
        updatedAtISO: now,
      });
      lines += 1;
    }
    return { countId, lines };
  },
});

// Add an item/location pair that wasn't expected (found stock not on the sheet).
export const addCountLine = mutation({
  args: {
    inventoryCountId: v.id("inventoryCounts"),
    inventoryItemId: v.id("inventoryItems"),
    locationId: v.id("inventoryLocations"),
    inventoryLotId: v.optional(v.id("inventoryLots")),
    countedQuantity: v.optional(v.number()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const count = await ctx.db.get(args.inventoryCountId);
    if (!count) throw new Error("Count not found.");
    const now = new Date().toISOString();
    return ctx.db.insert("inventoryCountLines", {
      societyId: count.societyId,
      inventoryCountId: args.inventoryCountId,
      inventoryItemId: args.inventoryItemId,
      inventoryLotId: args.inventoryLotId,
      locationId: args.locationId,
      expectedQuantity: 0,
      countedQuantity: args.countedQuantity,
      varianceQuantity: args.countedQuantity != null ? args.countedQuantity : undefined,
      condition: args.condition,
      status: args.countedQuantity != null ? "counted" : "pending",
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const setCountLine = mutation({
  args: {
    id: v.id("inventoryCountLines"),
    countedQuantity: v.optional(v.number()),
    condition: v.optional(v.string()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const line = await ctx.db.get(args.id);
    if (!line) throw new Error("Count line not found.");
    const now = new Date().toISOString();
    const countedQuantity = args.countedQuantity ?? line.countedQuantity;
    await ctx.db.patch(args.id, {
      countedQuantity,
      varianceQuantity: countedQuantity != null ? countedQuantity - (line.expectedQuantity ?? 0) : line.varianceQuantity,
      condition: args.condition ?? line.condition,
      status: args.status ?? (countedQuantity != null ? "counted" : line.status),
      notes: args.notes ?? line.notes,
      updatedAtISO: now,
    });
    return args.id;
  },
});

export const voidCount = mutation({
  args: { inventoryCountId: v.id("inventoryCounts") },
  returns: v.any(),
  handler: async (ctx, { inventoryCountId }) => {
    const now = new Date().toISOString();
    await ctx.db.patch(inventoryCountId, { status: "void", completedAtISO: now, updatedAtISO: now });
    return { voided: true };
  },
});

export const upsertCandidate = mutation({
  args: {
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    importSessionId: v.optional(v.id("importSessions")),
    candidateType: v.string(),
    sourceSystem: v.string(),
    sourceExternalId: v.optional(v.string()),
    occurredAtISO: v.optional(v.string()),
    sku: v.optional(v.string()),
    itemName: v.optional(v.string()),
    locationName: v.optional(v.string()),
    quantity: v.optional(v.number()),
    unitOfMeasure: v.optional(v.string()),
    suggestedInventoryItemId: v.optional(v.id("inventoryItems")),
    suggestedLocationId: v.optional(v.id("inventoryLocations")),
    rawJson: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return ctx.db.insert("inventoryCandidates", {
      ...args,
      status: "new",
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const linkReceipt = mutation({
  args: {
    id: v.optional(v.id("assetReceiptLinks")),
    societyId: v.id("societies"),
    inventoryItemId: v.optional(v.id("inventoryItems")),
    assetId: v.optional(v.id("assets")),
    receiptDocumentId: v.optional(v.id("documents")),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    receiptLineLabel: v.optional(v.string()),
    receiptLineIndex: v.optional(v.number()),
    quantity: v.optional(v.number()),
    unitOfMeasure: v.optional(v.string()),
    unitCostCents: v.optional(v.number()),
    totalCostCents: v.optional(v.number()),
    sourceText: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!args.inventoryItemId && !args.assetId) {
      throw new Error("Link a receipt to an inventory item or an asset.");
    }
    if (!args.receiptDocumentId && !args.financialTransactionId) {
      throw new Error("Choose a receipt document or a financial transaction to link.");
    }
    const now = new Date().toISOString();
    // Resolve the linked asset: explicit assetId wins, else inherit from the inventory item.
    let assetId = args.assetId;
    if (!assetId && args.inventoryItemId) {
      const item = await ctx.db.get(args.inventoryItemId);
      assetId = item?.assetId;
    }
    const { id, ...rest } = args;
    const payload = { ...rest, assetId, updatedAtISO: now };
    let linkId = id;
    if (linkId) {
      await ctx.db.patch(linkId, payload);
    } else {
      linkId = await ctx.db.insert("assetReceiptLinks", { ...payload, createdAtISO: now });
    }
    // Keep the asset register's purchase evidence in sync when an asset is involved.
    if (assetId) {
      const asset = await ctx.db.get(assetId);
      if (asset) {
        const patch: any = { updatedAtISO: now };
        if (!asset.receiptDocumentId && args.receiptDocumentId) patch.receiptDocumentId = args.receiptDocumentId;
        if (!asset.purchaseTransactionId && args.financialTransactionId) patch.purchaseTransactionId = args.financialTransactionId;
        if (args.receiptDocumentId) {
          patch.sourceDocumentIds = Array.from(new Set([...(asset.sourceDocumentIds ?? []), args.receiptDocumentId]));
        }
        await ctx.db.patch(assetId, patch);
      }
    }
    return linkId;
  },
});

export const unlinkReceipt = mutation({
  args: { id: v.id("assetReceiptLinks") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return { deleted: true };
  },
});

export const postStockMovement = mutation({
  args: {
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    movementDate: v.string(),
    movementType: v.string(),
    status: v.optional(v.string()),
    inventoryItemId: v.id("inventoryItems"),
    inventoryLotId: v.optional(v.id("inventoryLots")),
    fromLocationId: v.optional(v.id("inventoryLocations")),
    toLocationId: v.optional(v.id("inventoryLocations")),
    quantity: v.number(),
    unitOfMeasure: v.string(),
    unitCostCents: v.optional(v.number()),
    totalCostCents: v.optional(v.number()),
    reason: v.optional(v.string()),
    reference: v.optional(v.string()),
    sourceExternalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    assetEventId: v.optional(v.id("assetEvents")),
    purchaseTransactionId: v.optional(v.id("financialTransactions")),
    receiptDocumentId: v.optional(v.id("documents")),
    grantId: v.optional(v.id("grants")),
    fundRestrictionId: v.optional(v.id("fundRestrictions")),
    documentIds: v.optional(v.array(v.id("documents"))),
    rawJson: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.quantity <= 0) throw new Error("Stock movement quantity must be positive.");
    if (!args.fromLocationId && !args.toLocationId) {
      throw new Error("Stock movement needs at least one source or destination location.");
    }
    const status = args.status ?? "posted";
    // Guard against driving a posted balance negative when stock leaves a
    // location (consume / transfer-out / adjust-down). Internal flows (imports,
    // backfill, count reconciliation) bypass this mutation, so this only applies
    // to movements posted from the UI.
    if (status === "posted" && args.fromLocationId) {
      const fromDelta = args.quantity * movementSign(args.movementType, "from");
      if (fromDelta < 0) {
        const existing = await balanceFor(ctx, {
          inventoryItemId: args.inventoryItemId,
          inventoryLotId: args.inventoryLotId,
          locationId: args.fromLocationId,
        });
        const onHand = existing?.quantityOnHand ?? 0;
        if (onHand + fromDelta < 0) {
          throw new Error(`Not enough stock at the source location: ${onHand} on hand, tried to remove ${Math.abs(fromDelta)}.`);
        }
      }
    }
    const now = new Date().toISOString();
    const id = await ctx.db.insert("stockMovements", {
      ...args,
      status,
      sourceSystem: args.sourceSystem ?? "manual",
      documentIds: args.documentIds ?? [],
      createdAtISO: now,
      updatedAtISO: now,
    });
    const movement = await ctx.db.get(id);
    await postMovementEffects(ctx, movement);
    return id;
  },
});

export const postCountVarianceAdjustments = mutation({
  args: {
    inventoryCountId: v.id("inventoryCounts"),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { inventoryCountId, reason }) => {
    const count = await ctx.db.get(inventoryCountId);
    if (!count) return { adjusted: 0 };
    const now = new Date().toISOString();
    const lines = await ctx.db
      .query("inventoryCountLines")
      .withIndex("by_count", (q: any) => q.eq("inventoryCountId", inventoryCountId))
      .collect();
    let adjusted = 0;
    for (const line of lines) {
      if (line.adjustmentMovementId || line.countedQuantity == null || line.expectedQuantity == null) continue;
      const variance = line.countedQuantity - line.expectedQuantity;
      if (variance === 0) continue;
      const item = await ctx.db.get(line.inventoryItemId);
      const movementId = await ctx.db.insert("stockMovements", {
        societyId: count.societyId,
        movementDate: now.slice(0, 10),
        movementType: "adjustment",
        status: "posted",
        inventoryItemId: line.inventoryItemId,
        inventoryLotId: line.inventoryLotId,
        fromLocationId: variance < 0 ? line.locationId : undefined,
        toLocationId: variance > 0 ? line.locationId : undefined,
        quantity: Math.abs(variance),
        unitOfMeasure: item?.unitOfMeasure ?? "each",
        reason: reason ?? `Physical count variance: ${count.title}`,
        reference: count.title,
        sourceSystem: "societyer_count",
        documentIds: count.sourceDocumentIds ?? [],
        rawJson: JSON.stringify({ inventoryCountId, countLineId: line._id, expectedQuantity: line.expectedQuantity, countedQuantity: line.countedQuantity }),
        createdAtISO: now,
        updatedAtISO: now,
      });
      const movement = await ctx.db.get(movementId);
      await postMovementEffects(ctx, movement);
      await ctx.db.patch(line._id, {
        varianceQuantity: variance,
        adjustmentMovementId: movementId,
        status: "adjusted",
        updatedAtISO: now,
      });
      adjusted += 1;
    }
    await ctx.db.patch(inventoryCountId, {
      status: "completed",
      completedAtISO: count.completedAtISO ?? now,
      updatedAtISO: now,
    });
    return { adjusted };
  },
});

export const importOpenBoxesSnapshot = mutation({
  args: {
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    products: v.optional(v.array(v.object({
      id: v.string(),
      productCode: v.optional(v.string()),
      name: v.string(),
      category: v.optional(v.string()),
      unitOfMeasure: v.optional(v.string()),
      lotAndExpiryControl: v.optional(v.boolean()),
      serialized: v.optional(v.boolean()),
      rawJson: v.optional(v.string()),
    }))),
    locations: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      locationType: v.optional(v.string()),
      rawJson: v.optional(v.string()),
    }))),
    movements: v.optional(v.array(v.object({
      id: v.string(),
      date: v.string(),
      type: v.string(),
      productId: v.string(),
      originLocationId: v.optional(v.string()),
      destinationLocationId: v.optional(v.string()),
      quantity: v.number(),
      unitOfMeasure: v.optional(v.string()),
      reason: v.optional(v.string()),
      rawJson: v.optional(v.string()),
    }))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    let connectionId = args.connectionId;
    if (!connectionId) {
      connectionId = await ctx.db.insert("inventoryConnections", {
        societyId: args.societyId,
        provider: "openboxes",
        displayName: "OpenBoxes",
        status: "active",
        lastSyncedAtISO: now,
        createdAtISO: now,
        updatedAtISO: now,
      });
    }
    const itemByExternalId = new Map<string, any>();
    const locationByExternalId = new Map<string, any>();
    let itemsUpserted = 0;
    let locationsUpserted = 0;
    let movementsPosted = 0;

    const existingItems = await ctx.db
      .query("inventoryItems")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect();
    for (const product of args.products ?? []) {
      const existing = existingItems.find((row: any) => row.connectionId === connectionId && row.externalId === product.id);
      const payload = {
        societyId: args.societyId,
        connectionId,
        sku: product.productCode,
        name: product.name,
        category: product.category ?? "OpenBoxes",
        itemType: "supply",
        unitOfMeasure: product.unitOfMeasure ?? "each",
        currency: "CAD",
        trackSerial: product.serialized ?? false,
        trackLot: product.lotAndExpiryControl ?? false,
        trackExpiry: product.lotAndExpiryControl ?? false,
        status: "active",
        externalId: product.id,
        sourceSystem: "openboxes",
        rawJson: product.rawJson,
        updatedAtISO: now,
      };
      const id = existing
        ? (await ctx.db.patch(existing._id, payload), existing._id)
        : await ctx.db.insert("inventoryItems", { ...payload, createdAtISO: now });
      itemByExternalId.set(product.id, { _id: id, ...payload });
      itemsUpserted += 1;
    }

    const existingLocations = await ctx.db
      .query("inventoryLocations")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect();
    for (const location of args.locations ?? []) {
      const existing = existingLocations.find((row: any) => row.connectionId === connectionId && row.externalId === location.id);
      const payload = {
        societyId: args.societyId,
        connectionId,
        name: location.name,
        locationType: location.locationType ?? "facility",
        active: true,
        externalId: location.id,
        sourceSystem: "openboxes",
        rawJson: location.rawJson,
        updatedAtISO: now,
      };
      const id = existing
        ? (await ctx.db.patch(existing._id, payload), existing._id)
        : await ctx.db.insert("inventoryLocations", { ...payload, createdAtISO: now });
      locationByExternalId.set(location.id, { _id: id, ...payload });
      locationsUpserted += 1;
    }

    for (const movement of args.movements ?? []) {
      const already = await ctx.db
        .query("stockMovements")
        .withIndex("by_connection_external", (q: any) => q.eq("connectionId", connectionId).eq("sourceExternalId", movement.id))
        .first();
      if (already) continue;
      const item = itemByExternalId.get(movement.productId) ?? existingItems.find((row: any) => row.connectionId === connectionId && row.externalId === movement.productId);
      if (!item) continue;
      const from = movement.originLocationId ? locationByExternalId.get(movement.originLocationId) ?? existingLocations.find((row: any) => row.connectionId === connectionId && row.externalId === movement.originLocationId) : null;
      const to = movement.destinationLocationId ? locationByExternalId.get(movement.destinationLocationId) ?? existingLocations.find((row: any) => row.connectionId === connectionId && row.externalId === movement.destinationLocationId) : null;
      const movementId = await ctx.db.insert("stockMovements", {
        societyId: args.societyId,
        connectionId,
        movementDate: movement.date,
        movementType: movement.type,
        status: "posted",
        inventoryItemId: item._id,
        fromLocationId: from?._id,
        toLocationId: to?._id,
        quantity: movement.quantity,
        unitOfMeasure: movement.unitOfMeasure ?? item.unitOfMeasure ?? "each",
        reason: movement.reason,
        sourceExternalId: movement.id,
        sourceSystem: "openboxes",
        documentIds: [],
        rawJson: movement.rawJson,
        createdAtISO: now,
        updatedAtISO: now,
      });
      const row = await ctx.db.get(movementId);
      await postMovementEffects(ctx, row);
      movementsPosted += 1;
    }
    await ctx.db.patch(connectionId, { lastSyncedAtISO: now, updatedAtISO: now });
    return { connectionId, itemsUpserted, locationsUpserted, movementsPosted };
  },
});

export const createItemFromAsset = mutation({
  args: { assetId: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { assetId }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset) return null;
    const existing = await ctx.db
      .query("inventoryItems")
      .withIndex("by_asset", (q: any) => q.eq("assetId", assetId))
      .first();
    if (existing) return existing._id;
    const now = new Date().toISOString();
    return ctx.db.insert("inventoryItems", {
      societyId: asset.societyId,
      sku: asset.assetTag,
      name: asset.name,
      description: asset.notes,
      category: asset.category,
      itemType: asset.category === "Consumable" ? "consumable" : "asset",
      unitOfMeasure: asset.quantityUnit ?? "each",
      defaultCostCents: asset.purchaseValueCents,
      currency: asset.currency ?? "CAD",
      trackSerial: Boolean(asset.serialNumber),
      trackLot: false,
      trackExpiry: false,
      status: asset.status === "Disposed" ? "archived" : "active",
      assetId,
      sourceSystem: "societyer_assets",
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const recordAssetStockIntake = mutation({
  args: {
    assetId: v.id("assets"),
    assetEventId: v.id("assetEvents"),
    observedQuantityBefore: v.number(),
    quantityAdded: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.quantityAdded <= 0) return null;
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    const itemId = await createInventoryItemForAsset(ctx, asset);
    const locationId = await findOrCreateLocation(ctx, {
      societyId: asset.societyId,
      name: asset.location ?? asset.custodianName ?? "Inventory",
      locationType: asset.location ? "facility" : "virtual",
      sourceSystem: "societyer_assets",
    });
    const now = new Date().toISOString();
    const movementId = await ctx.db.insert("stockMovements", {
      societyId: asset.societyId,
      movementDate: now.slice(0, 10),
      movementType: "receive",
      status: "posted",
      inventoryItemId: itemId,
      toLocationId: locationId,
      quantity: args.quantityAdded,
      unitOfMeasure: asset.quantityUnit ?? "each",
      reference: asset.assetTag,
      sourceSystem: "societyer_assets",
      assetEventId: args.assetEventId,
      purchaseTransactionId: asset.purchaseTransactionId,
      receiptDocumentId: asset.receiptDocumentId,
      grantId: asset.grantId,
      documentIds: asset.sourceDocumentIds ?? [],
      rawJson: JSON.stringify({
        observedQuantityBefore: args.observedQuantityBefore,
        quantityAdded: args.quantityAdded,
      }),
      createdAtISO: now,
      updatedAtISO: now,
    });
    const movement = await ctx.db.get(movementId);
    await postMovementEffects(ctx, movement);
    return movementId;
  },
});

export const backfillAssets = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    let itemsCreated = 0;
    let locationsCreated = 0;
    let movementsCreated = 0;
    let balancesCreated = 0;
    for (const asset of assets) {
      const existingItem = await ctx.db
        .query("inventoryItems")
        .withIndex("by_asset", (q: any) => q.eq("assetId", asset._id))
        .first();
      const itemId = existingItem?._id ?? await createInventoryItemForAsset(ctx, asset);
      if (!existingItem) itemsCreated += 1;
      const beforeLocations = await ctx.db
        .query("inventoryLocations")
        .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
        .collect();
      const locationId = await findOrCreateLocation(ctx, {
        societyId,
        name: asset.location ?? asset.custodianName ?? "Inventory",
        locationType: asset.location ? "facility" : "virtual",
        sourceSystem: "societyer_assets",
      });
      if (!beforeLocations.some((row: any) => row._id === locationId)) locationsCreated += 1;
      const existingMovements = await ctx.db
        .query("stockMovements")
        .withIndex("by_item_date", (q: any) => q.eq("inventoryItemId", itemId))
        .collect();
      if (existingMovements.length > 0) continue;
      const quantity = asset.category === "Consumable" ? asset.quantityOnHand ?? 0 : asset.status === "Disposed" || asset.status === "Lost" ? 0 : 1;
      if (quantity <= 0) continue;
      const now = new Date().toISOString();
      const movementId = await ctx.db.insert("stockMovements", {
        societyId,
        movementDate: asset.purchaseDate ?? now.slice(0, 10),
        movementType: "receive",
        status: "posted",
        inventoryItemId: itemId,
        toLocationId: locationId,
        quantity,
        unitOfMeasure: asset.quantityUnit ?? "each",
        unitCostCents: asset.purchaseValueCents,
        totalCostCents: asset.purchaseValueCents && quantity ? Math.round(asset.purchaseValueCents * quantity) : undefined,
        reason: "Backfilled from Societyer asset register",
        reference: asset.assetTag,
        sourceSystem: "societyer_assets",
        purchaseTransactionId: asset.purchaseTransactionId,
        receiptDocumentId: asset.receiptDocumentId,
        grantId: asset.grantId,
        documentIds: asset.sourceDocumentIds ?? [],
        createdAtISO: now,
        updatedAtISO: now,
      });
      movementsCreated += 1;
      const existingBalance = await balanceFor(ctx, { inventoryItemId: itemId, locationId });
      if (!existingBalance) balancesCreated += 1;
      const movement = await ctx.db.get(movementId);
      await postMovementEffects(ctx, movement);
    }
    return { itemsCreated, locationsCreated, movementsCreated, balancesCreated };
  },
});

async function createInventoryItemForAsset(ctx: any, asset: any) {
  const existing = await ctx.db
    .query("inventoryItems")
    .withIndex("by_asset", (q: any) => q.eq("assetId", asset._id))
    .first();
  if (existing) return existing._id;
  const now = new Date().toISOString();
  return ctx.db.insert("inventoryItems", {
    societyId: asset.societyId,
    sku: asset.assetTag,
    name: asset.name,
    description: asset.notes,
    category: asset.category,
    itemType: asset.category === "Consumable" ? "consumable" : "asset",
    unitOfMeasure: asset.quantityUnit ?? "each",
    defaultCostCents: asset.purchaseValueCents,
    currency: asset.currency ?? "CAD",
    trackSerial: Boolean(asset.serialNumber),
    trackLot: false,
    trackExpiry: false,
    status: asset.status === "Disposed" ? "archived" : "active",
    assetId: asset._id,
    sourceSystem: "societyer_assets",
    createdAtISO: now,
    updatedAtISO: now,
  });
}
