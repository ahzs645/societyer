import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";

const assetPatch = v.object({
  assetTag: v.optional(v.string()),
  preferredLabelType: v.optional(v.string()),
  name: v.optional(v.string()),
  category: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  supplier: v.optional(v.string()),
  purchaseDate: v.optional(v.string()),
  purchaseValueCents: v.optional(v.number()),
  quantityOnHand: v.optional(v.number()),
  quantityUnit: v.optional(v.string()),
  currency: v.optional(v.string()),
  fundingSource: v.optional(v.string()),
  grantId: v.optional(v.id("grants")),
  grantRestrictions: v.optional(v.string()),
  retentionUntil: v.optional(v.string()),
  disposalRules: v.optional(v.string()),
  location: v.optional(v.string()),
  condition: v.optional(v.string()),
  status: v.optional(v.string()),
  custodianType: v.optional(v.string()),
  custodianId: v.optional(v.string()),
  custodianName: v.optional(v.string()),
  responsiblePersonName: v.optional(v.string()),
  expectedReturnDate: v.optional(v.string()),
  insurancePolicyId: v.optional(v.id("insurancePolicies")),
  insuranceNotes: v.optional(v.string()),
  capitalized: v.optional(v.boolean()),
  depreciationMethod: v.optional(v.string()),
  usefulLifeMonths: v.optional(v.number()),
  bookValueCents: v.optional(v.number()),
  imageStorageId: v.optional(v.id("_storage")),
  imageUrl: v.optional(v.string()),
  clearImage: v.optional(v.boolean()),
  purchaseTransactionId: v.optional(v.id("financialTransactions")),
  receiptDocumentId: v.optional(v.id("documents")),
  sourceDocumentIds: v.optional(v.array(v.id("documents"))),
  warrantyExpiresAt: v.optional(v.string()),
  nextMaintenanceDate: v.optional(v.string()),
  nextVerificationDate: v.optional(v.string()),
  disposedAt: v.optional(v.string()),
  disposalMethod: v.optional(v.string()),
  disposalReason: v.optional(v.string()),
  disposalValueCents: v.optional(v.number()),
  disposalApprovedMeetingId: v.optional(v.id("meetings")),
  disposalDocumentIds: v.optional(v.array(v.id("documents"))),
  notes: v.optional(v.string()),
});

const eventInput = v.object({
  eventType: v.string(),
  actorName: v.optional(v.string()),
  toCustodianType: v.optional(v.string()),
  toCustodianId: v.optional(v.string()),
  toCustodianName: v.optional(v.string()),
  responsiblePersonName: v.optional(v.string()),
  location: v.optional(v.string()),
  condition: v.optional(v.string()),
  observedQuantityBefore: v.optional(v.number()),
  quantityAdded: v.optional(v.number()),
  quantityAfter: v.optional(v.number()),
  expectedReturnDate: v.optional(v.string()),
  acceptanceSignature: v.optional(v.string()),
  documentIds: v.optional(v.array(v.id("documents"))),
  notes: v.optional(v.string()),
});

async function findOrCreateInventoryItemForAsset(ctx: any, asset: any) {
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

async function findOrCreateInventoryLocationForAsset(ctx: any, asset: any) {
  const name = String(asset.location ?? asset.custodianName ?? "Inventory").trim() || "Inventory";
  const existing = await ctx.db
    .query("inventoryLocations")
    .withIndex("by_society", (q: any) => q.eq("societyId", asset.societyId))
    .collect();
  const match = existing.find((row: any) => row.name.toLowerCase() === name.toLowerCase());
  if (match) return match._id;
  const now = new Date().toISOString();
  return ctx.db.insert("inventoryLocations", {
    societyId: asset.societyId,
    name,
    locationType: asset.location ? "facility" : "virtual",
    active: true,
    sourceSystem: "societyer_assets",
    createdAtISO: now,
    updatedAtISO: now,
  });
}

async function balanceFor(ctx: any, inventoryItemId: any, locationId: any) {
  const rows = await ctx.db
    .query("inventoryBalances")
    .withIndex("by_item_location", (q: any) => q.eq("inventoryItemId", inventoryItemId).eq("locationId", locationId))
    .collect();
  return rows.find((row: any) => row.inventoryLotId === undefined);
}

async function recordConsumableStockMovement(
  ctx: any,
  asset: any,
  assetEventId: any,
  observedQuantityBefore: number,
  quantityAdded: number,
) {
  if (quantityAdded <= 0) return null;
  const now = new Date().toISOString();
  const inventoryItemId = await findOrCreateInventoryItemForAsset(ctx, asset);
  const toLocationId = await findOrCreateInventoryLocationForAsset(ctx, asset);
  const movementId = await ctx.db.insert("stockMovements", {
    societyId: asset.societyId,
    movementDate: now.slice(0, 10),
    movementType: "receive",
    status: "posted",
    inventoryItemId,
    toLocationId,
    quantity: quantityAdded,
    unitOfMeasure: asset.quantityUnit ?? "each",
    reference: asset.assetTag,
    sourceSystem: "societyer_assets",
    assetEventId,
    purchaseTransactionId: asset.purchaseTransactionId,
    receiptDocumentId: asset.receiptDocumentId,
    grantId: asset.grantId,
    documentIds: asset.sourceDocumentIds ?? [],
    rawJson: JSON.stringify({ observedQuantityBefore, quantityAdded }),
    createdAtISO: now,
    updatedAtISO: now,
  });
  const existingBalance = await balanceFor(ctx, inventoryItemId, toLocationId);
  if (existingBalance) {
    const quantityOnHand = existingBalance.quantityOnHand + quantityAdded;
    const quantityReserved = existingBalance.quantityReserved ?? 0;
    await ctx.db.patch(existingBalance._id, {
      quantityOnHand,
      quantityAvailable: quantityOnHand - quantityReserved,
      lastMovementId: movementId,
      updatedAtISO: now,
    });
  } else {
    await ctx.db.insert("inventoryBalances", {
      societyId: asset.societyId,
      inventoryItemId,
      locationId: toLocationId,
      quantityOnHand: quantityAdded,
      quantityReserved: 0,
      quantityAvailable: quantityAdded,
      lastMovementId: movementId,
      createdAtISO: now,
      updatedAtISO: now,
    });
  }
  return movementId;
}

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    return Promise.all(
      rows.map(async (row: any) => ({
        ...row,
        imageUrl: row.imageStorageId ? (await ctx.storage.getUrl(row.imageStorageId)) ?? row.imageUrl : row.imageUrl,
      })),
    );
  },
});

export const get = query({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const bundle = query({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const asset = await ctx.db.get(id);
    if (!asset) return null;
    if (asset.imageStorageId) {
      asset.imageUrl = (await ctx.storage.getUrl(asset.imageStorageId)) ?? asset.imageUrl;
    }
    const [events, maintenance, receiptLinks] = await Promise.all([
      ctx.db
        .query("assetEvents")
        .withIndex("by_asset_happened", (q: any) => q.eq("assetId", id))
        .order("desc")
        .collect(),
      ctx.db
        .query("assetMaintenance")
        .withIndex("by_asset", (q: any) => q.eq("assetId", id))
        .collect(),
      ctx.db
        .query("assetReceiptLinks")
        .withIndex("by_asset", (q: any) => q.eq("assetId", id))
        .collect(),
    ]);
    return { asset, events, maintenance, receiptLinks };
  },
});

export const receiptLinks = query({
  args: { societyId: v.id("societies"), receiptDocumentId: v.optional(v.id("documents")) },
  returns: v.any(),
  handler: async (ctx, { societyId, receiptDocumentId }) => {
    const rows = receiptDocumentId
      ? await ctx.db
          .query("assetReceiptLinks")
          .withIndex("by_receipt_document", (q: any) => q.eq("receiptDocumentId", receiptDocumentId))
          .collect()
      : await ctx.db
          .query("assetReceiptLinks")
          .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
          .collect();
    return rows.filter((row: any) => row.societyId === societyId);
  },
});

export const events = query({
  args: { assetId: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { assetId }) =>
    ctx.db
      .query("assetEvents")
      .withIndex("by_asset_happened", (q: any) => q.eq("assetId", assetId))
      .order("desc")
      .collect(),
});

export const maintenance = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("assetMaintenance")
      .withIndex("by_society_due", (q: any) => q.eq("societyId", societyId))
      .collect(),
});

export const verificationRuns = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("assetVerificationRuns")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect(),
});

export const verificationItems = query({
  args: { runId: v.id("assetVerificationRuns") },
  returns: v.any(),
  handler: async (ctx, { runId }) =>
    ctx.db
      .query("assetVerificationItems")
      .withIndex("by_run", (q: any) => q.eq("runId", runId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    assetTag: v.string(),
    preferredLabelType: v.optional(v.string()),
    name: v.string(),
    category: v.string(),
    serialNumber: v.optional(v.string()),
    supplier: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    purchaseValueCents: v.optional(v.number()),
    quantityOnHand: v.optional(v.number()),
    quantityUnit: v.optional(v.string()),
    currency: v.optional(v.string()),
    fundingSource: v.optional(v.string()),
    grantId: v.optional(v.id("grants")),
    grantRestrictions: v.optional(v.string()),
    retentionUntil: v.optional(v.string()),
    disposalRules: v.optional(v.string()),
    location: v.optional(v.string()),
    condition: v.string(),
    status: v.string(),
    custodianType: v.optional(v.string()),
    custodianId: v.optional(v.string()),
    custodianName: v.optional(v.string()),
    responsiblePersonName: v.optional(v.string()),
    expectedReturnDate: v.optional(v.string()),
    insurancePolicyId: v.optional(v.id("insurancePolicies")),
    insuranceNotes: v.optional(v.string()),
    capitalized: v.boolean(),
    depreciationMethod: v.optional(v.string()),
    usefulLifeMonths: v.optional(v.number()),
    bookValueCents: v.optional(v.number()),
    imageStorageId: v.optional(v.id("_storage")),
    imageUrl: v.optional(v.string()),
    clearImage: v.optional(v.boolean()),
    purchaseTransactionId: v.optional(v.id("financialTransactions")),
    receiptDocumentId: v.optional(v.id("documents")),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    warrantyExpiresAt: v.optional(v.string()),
    nextMaintenanceDate: v.optional(v.string()),
    nextVerificationDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const { clearImage: _clearImage, ...insertArgs } = args;
    const id = await ctx.db.insert("assets", {
      ...insertArgs,
      currency: args.currency ?? "CAD",
      sourceDocumentIds: args.sourceDocumentIds ?? [],
      disposalDocumentIds: [],
      createdAtISO: now,
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: args.societyId,
      assetId: id,
      eventType: "intake",
      happenedAtISO: now,
      toCustodianType: args.custodianType,
      toCustodianId: args.custodianId,
      toCustodianName: args.custodianName,
      responsiblePersonName: args.responsiblePersonName,
      location: args.location,
      condition: args.condition,
      quantityAfter: args.quantityOnHand,
      documentIds: args.sourceDocumentIds ?? [],
      notes: args.notes,
      createdAtISO: now,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "asset",
      entityId: id,
      action: "created",
      summary: `Created asset ${args.assetTag} — ${args.name}`,
      createdAtISO: now,
    });
    return id;
  },
});

export const update = mutation({
  args: { id: v.id("assets"), patch: assetPatch },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    const { clearImage, ...rest } = patch as any;
    const next: any = { ...rest, updatedAtISO: new Date().toISOString() };
    // Convex patch ignores undefined args, so clearing an image needs an explicit signal.
    if (clearImage) {
      next.imageStorageId = undefined;
      next.imageUrl = undefined;
    }
    await ctx.db.patch(id, next);
    return id;
  },
});

export const addConsumableStock = mutation({
  args: {
    assetId: v.id("assets"),
    observedQuantityBefore: v.number(),
    quantityAdded: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { assetId, observedQuantityBefore, quantityAdded, notes }) => {
    if (observedQuantityBefore < 0 || quantityAdded < 0) {
      throw new Error("Consumable quantities cannot be negative.");
    }
    const asset = await ctx.db.get(assetId);
    if (!asset) return null;
    if (asset.category !== "Consumable") {
      throw new Error("Stock intake can only be recorded for consumable items.");
    }
    const now = new Date().toISOString();
    const quantityAfter = observedQuantityBefore + quantityAdded;
    const eventId = await ctx.db.insert("assetEvents", {
      societyId: asset.societyId,
      assetId,
      eventType: "stock_intake",
      happenedAtISO: now,
      condition: asset.condition,
      observedQuantityBefore,
      quantityAdded,
      quantityAfter,
      documentIds: [],
      notes,
      createdAtISO: now,
    });
    await recordConsumableStockMovement(ctx, asset, eventId, observedQuantityBefore, quantityAdded);
    await ctx.db.patch(assetId, {
      quantityOnHand: quantityAfter,
      updatedAtISO: now,
    });
    await ctx.db.insert("activity", {
      societyId: asset.societyId,
      actor: "You",
      entityType: "asset",
      entityId: assetId,
      action: "stock_intake",
      summary: `Added ${quantityAdded} ${asset.quantityUnit ?? "unit"}${quantityAdded === 1 ? "" : "s"} to ${asset.assetTag}; ${quantityAfter} now on hand`,
      createdAtISO: now,
    });
    return eventId;
  },
});

export const linkReceiptLine = mutation({
  args: {
    societyId: v.id("societies"),
    assetId: v.id("assets"),
    receiptDocumentId: v.id("documents"),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    receiptLineLabel: v.optional(v.string()),
    receiptLineIndex: v.optional(v.number()),
    quantity: v.optional(v.number()),
    unitOfMeasure: v.optional(v.string()),
    unitCostCents: v.optional(v.number()),
    totalCostCents: v.optional(v.number()),
    sourceText: v.optional(v.string()),
    notes: v.optional(v.string()),
    createInventoryItem: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const [asset, document, transaction] = await Promise.all([
      ctx.db.get(args.assetId),
      ctx.db.get(args.receiptDocumentId),
      args.financialTransactionId ? ctx.db.get(args.financialTransactionId) : Promise.resolve(null),
    ]);
    if (!asset || asset.societyId !== args.societyId) throw new Error("Asset must belong to this society.");
    if (!document || document.societyId !== args.societyId) throw new Error("Receipt document must belong to this society.");
    if (transaction && transaction.societyId !== args.societyId) throw new Error("Financial transaction must belong to this society.");
    if (args.quantity !== undefined && args.quantity <= 0) throw new Error("Receipt line quantity must be positive.");
    const now = new Date().toISOString();
    const inventoryItemId = args.createInventoryItem ? await findOrCreateInventoryItemForAsset(ctx, asset) : undefined;
    const linkId = await ctx.db.insert("assetReceiptLinks", {
      societyId: args.societyId,
      assetId: args.assetId,
      inventoryItemId,
      receiptDocumentId: args.receiptDocumentId,
      financialTransactionId: args.financialTransactionId,
      receiptLineLabel: args.receiptLineLabel,
      receiptLineIndex: args.receiptLineIndex,
      quantity: args.quantity,
      unitOfMeasure: args.unitOfMeasure,
      unitCostCents: args.unitCostCents,
      totalCostCents: args.totalCostCents,
      sourceText: args.sourceText,
      notes: args.notes,
      createdByUserId: args.actingUserId,
      createdAtISO: now,
      updatedAtISO: now,
    });
    const documentIds = new Set([...(asset.sourceDocumentIds ?? []), args.receiptDocumentId]);
    await ctx.db.patch(args.assetId, {
      receiptDocumentId: asset.receiptDocumentId ?? args.receiptDocumentId,
      purchaseTransactionId: asset.purchaseTransactionId ?? args.financialTransactionId,
      sourceDocumentIds: Array.from(documentIds),
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: args.societyId,
      assetId: args.assetId,
      eventType: "receipt_link",
      happenedAtISO: now,
      documentIds: [args.receiptDocumentId],
      notes: [args.receiptLineLabel, args.notes].filter(Boolean).join(" — "),
      createdAtISO: now,
    });
    return { linkId, inventoryItemId };
  },
});

export const recordEvent = mutation({
  args: { assetId: v.id("assets"), event: eventInput },
  returns: v.any(),
  handler: async (ctx, { assetId, event }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    const eventId = await ctx.db.insert("assetEvents", {
      societyId: asset.societyId,
      assetId,
      eventType: event.eventType,
      happenedAtISO: now,
      actorName: event.actorName,
      fromCustodianName: asset.custodianName,
      toCustodianType: event.toCustodianType,
      toCustodianId: event.toCustodianId,
      toCustodianName: event.toCustodianName,
      responsiblePersonName: event.responsiblePersonName,
      location: event.location,
      condition: event.condition,
      expectedReturnDate: event.expectedReturnDate,
      acceptanceSignature: event.acceptanceSignature,
      documentIds: event.documentIds ?? [],
      notes: event.notes,
      createdAtISO: now,
    });

    const patch: any = { updatedAtISO: now };
    if (event.eventType === "checkout" || event.eventType === "transfer") {
      patch.status = "Checked out";
      patch.custodianType = event.toCustodianType;
      patch.custodianId = event.toCustodianId;
      patch.custodianName = event.toCustodianName;
      patch.responsiblePersonName = event.responsiblePersonName || event.toCustodianName;
      patch.expectedReturnDate = event.expectedReturnDate;
    }
    if (event.eventType === "checkin") {
      patch.status = "Available";
      patch.custodianType = "location";
      patch.custodianId = undefined;
      patch.custodianName = event.location;
      patch.responsiblePersonName = event.responsiblePersonName;
      patch.expectedReturnDate = undefined;
    }
    if (event.location !== undefined) patch.location = event.location;
    if (event.condition !== undefined) patch.condition = event.condition;
    await ctx.db.patch(assetId, patch);
    await ctx.db.insert("activity", {
      societyId: asset.societyId,
      actor: "You",
      entityType: "asset",
      entityId: assetId,
      action: event.eventType,
      summary: `${event.eventType} for asset ${asset.assetTag}`,
      createdAtISO: now,
    });
    return eventId;
  },
});

export const scheduleMaintenance = mutation({
  args: {
    assetId: v.id("assets"),
    title: v.string(),
    kind: v.string(),
    dueDate: v.string(),
    notes: v.optional(v.string()),
    createTask: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    let taskId;
    if (args.createTask) {
      taskId = await ctx.db.insert("tasks", {
        societyId: asset.societyId,
        title: `${args.title}: ${asset.assetTag}`,
        description: args.notes,
        status: "Todo",
        priority: "Medium",
        assignee: asset.responsiblePersonName,
        dueDate: args.dueDate,
        tags: ["asset", args.kind],
        createdAtISO: now,
      });
    }
    const id = await ctx.db.insert("assetMaintenance", {
      societyId: asset.societyId,
      assetId: args.assetId,
      title: args.title,
      kind: args.kind,
      dueDate: args.dueDate,
      status: "Scheduled",
      taskId,
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    await ctx.db.patch(args.assetId, {
      nextMaintenanceDate: args.dueDate,
      updatedAtISO: now,
    });
    return id;
  },
});

export const completeMaintenance = mutation({
  args: {
    id: v.id("assetMaintenance"),
    completedAtISO: v.optional(v.string()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const now = new Date().toISOString();
    await ctx.db.patch(args.id, {
      status: "Completed",
      completedAtISO: args.completedAtISO ?? now,
      notes: args.notes ?? row.notes,
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: row.societyId,
      assetId: row.assetId,
      eventType: "maintenance",
      happenedAtISO: args.completedAtISO ?? now,
      condition: args.condition,
      documentIds: [],
      notes: args.notes ?? row.notes,
      createdAtISO: now,
    });
    if (row.taskId) await ctx.db.patch(row.taskId, { status: "Done", completedAt: now });
    if (args.condition) {
      await ctx.db.patch(row.assetId, { condition: args.condition, updatedAtISO: now });
    }
    return args.id;
  },
});

export const startVerificationRun = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    reviewerName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect();
    const runId = await ctx.db.insert("assetVerificationRuns", {
      societyId: args.societyId,
      title: args.title,
      status: "Open",
      startedAtISO: now,
      reviewerName: args.reviewerName,
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    const inventoryCountId = await ctx.db.insert("inventoryCounts", {
      societyId: args.societyId,
      title: args.title,
      status: "open",
      startedAtISO: now,
      reviewerName: args.reviewerName,
      scope: "assets",
      sourceDocumentIds: [],
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    await Promise.all(
      assets.map(async (asset: any) => {
        const itemId = await findOrCreateInventoryItemForAsset(ctx, asset);
        const locationId = await findOrCreateInventoryLocationForAsset(ctx, asset);
        const expectedQuantity = asset.category === "Consumable"
          ? asset.quantityOnHand ?? 0
          : asset.status === "Disposed" || asset.status === "Lost"
            ? 0
            : 1;
        await ctx.db.insert("inventoryCountLines", {
          societyId: args.societyId,
          inventoryCountId,
          inventoryItemId: itemId,
          locationId,
          expectedQuantity,
          status: "pending",
          createdAtISO: now,
          updatedAtISO: now,
        });
        return ctx.db.insert("assetVerificationItems", {
          societyId: args.societyId,
          runId,
          assetId: asset._id,
          status: "pending",
          createdAtISO: now,
          updatedAtISO: now,
        });
      }),
    );
    return runId;
  },
});

export const verifyAsset = mutation({
  args: {
    itemId: v.id("assetVerificationItems"),
    status: v.string(),
    verifiedByName: v.optional(v.string()),
    observedLocation: v.optional(v.string()),
    observedCondition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const now = new Date().toISOString();
    await ctx.db.patch(args.itemId, {
      status: args.status,
      verifiedAtISO: now,
      verifiedByName: args.verifiedByName,
      observedLocation: args.observedLocation,
      observedCondition: args.observedCondition,
      notes: args.notes,
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: item.societyId,
      assetId: item.assetId,
      eventType: "verification",
      happenedAtISO: now,
      actorName: args.verifiedByName,
      location: args.observedLocation,
      condition: args.observedCondition,
      documentIds: [],
      notes: `${args.status}${args.notes ? ` — ${args.notes}` : ""}`,
      createdAtISO: now,
    });
    await ctx.db.patch(item.assetId, {
      nextVerificationDate: undefined,
      ...(args.observedLocation ? { location: args.observedLocation } : {}),
      ...(args.observedCondition ? { condition: args.observedCondition } : {}),
      updatedAtISO: now,
    });
    const asset = await ctx.db.get(item.assetId);
    if (asset) {
      const inventoryItem = await ctx.db
        .query("inventoryItems")
        .withIndex("by_asset", (q: any) => q.eq("assetId", item.assetId))
        .first();
      if (inventoryItem) {
        const run = await ctx.db.get(item.runId);
        const counts = run
          ? await ctx.db
              .query("inventoryCounts")
              .withIndex("by_society_status", (q: any) => q.eq("societyId", item.societyId).eq("status", "open"))
              .collect()
          : [];
        const count = counts.find((row: any) => row.title === run?.title && row.startedAtISO === run?.startedAtISO);
        if (count) {
          const lines = await ctx.db
            .query("inventoryCountLines")
            .withIndex("by_count", (q: any) => q.eq("inventoryCountId", count._id))
            .collect();
          const line = lines.find((row: any) => row.inventoryItemId === inventoryItem._id);
          if (line) {
            const countedQuantity = args.status === "missing" ? 0 : line.expectedQuantity ?? (asset.category === "Consumable" ? asset.quantityOnHand ?? 0 : 1);
            await ctx.db.patch(line._id, {
              countedQuantity,
              varianceQuantity: countedQuantity - (line.expectedQuantity ?? 0),
              condition: args.observedCondition,
              status: args.status === "verified" ? "counted" : args.status,
              notes: args.notes,
              updatedAtISO: now,
            });
          }
        }
      }
    }
    return args.itemId;
  },
});

export const completeVerificationRun = mutation({
  args: { id: v.id("assetVerificationRuns") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const now = new Date().toISOString();
    await ctx.db.patch(id, { status: "Completed", completedAtISO: now, updatedAtISO: now });
    const run = await ctx.db.get(id);
    if (run) {
      const counts = await ctx.db
        .query("inventoryCounts")
        .withIndex("by_society_status", (q: any) => q.eq("societyId", run.societyId).eq("status", "open"))
        .collect();
      const count = counts.find((row: any) => row.title === run.title && row.startedAtISO === run.startedAtISO);
      if (count) await ctx.db.patch(count._id, { status: "completed", completedAtISO: now, updatedAtISO: now });
    }
    return id;
  },
});

export const dispose = mutation({
  args: {
    assetId: v.id("assets"),
    disposedAt: v.string(),
    disposalMethod: v.string(),
    disposalReason: v.string(),
    disposalValueCents: v.optional(v.number()),
    disposalApprovedMeetingId: v.optional(v.id("meetings")),
    disposalDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    await ctx.db.patch(args.assetId, {
      status: "Disposed",
      disposedAt: args.disposedAt,
      disposalMethod: args.disposalMethod,
      disposalReason: args.disposalReason,
      disposalValueCents: args.disposalValueCents,
      disposalApprovedMeetingId: args.disposalApprovedMeetingId,
      disposalDocumentIds: args.disposalDocumentIds ?? [],
      notes: args.notes ?? asset.notes,
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: asset.societyId,
      assetId: args.assetId,
      eventType: "disposal",
      happenedAtISO: args.disposedAt,
      actorName: "You",
      documentIds: args.disposalDocumentIds ?? [],
      notes: `${args.disposalMethod}: ${args.disposalReason}`,
      createdAtISO: now,
    });
    return args.assetId;
  },
});

export const remove = mutation({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return null;
  },
});
