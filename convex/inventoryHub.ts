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
    return rows.sort((a: any, b: any) => a.name.localeCompare(b.name));
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
      currency: payload.currency ?? "CAD",
      trackSerial: payload.trackSerial ?? false,
      trackLot: payload.trackLot ?? false,
      trackExpiry: payload.trackExpiry ?? false,
      status: payload.status ?? "active",
      sourceSystem: payload.sourceSystem ?? "manual",
      updatedAtISO: now,
    };
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
    locationType: v.string(),
    parentLocationId: v.optional(v.id("inventoryLocations")),
    address: v.optional(v.string()),
    active: v.optional(v.boolean()),
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
    const now = new Date().toISOString();
    const id = await ctx.db.insert("stockMovements", {
      ...args,
      status: args.status ?? "posted",
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
