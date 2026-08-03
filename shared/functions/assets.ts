/**
 * PORTABLE FUNCTIONS: the assets domain (fixed-asset & consumable register).
 *
 * The `ctx.db`-only handlers plus the image-resolving reads (`list`/`bundle`),
 * which resolve asset image blob URLs through the injected
 * `ctx.capabilities.storage`. Each handler below runs unchanged on hosted
 * Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * Reads/writes the asset register tables plus the inventory mirror tables over
 * `ctx.db`.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { claimStorageId, getOwned, principalUserId, requireSocietyMembership } from "./access";

/* ----------------------------- Helpers ----------------------------- */

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

/* ----------------------------- Queries ----------------------------- */

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("assets")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  return Promise.all(
    rows.map(async (row: any) => ({
      ...row,
      imageUrl: row.imageStorageId ? (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(row.imageStorageId) })).url ?? row.imageUrl : row.imageUrl,
    })),
  );
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const row = await ctx.db.get(id, "assets");
  if (!row) return null;
  await requireSocietyMembership(ctx, String(row.societyId));
  return getOwned(ctx, "assets", id, String(row.societyId));
}

export async function bundlePortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "assets");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const asset = await getOwned(ctx, "assets", id, String(candidate.societyId));
  if (!asset) return null;
  if (asset.imageStorageId) {
    asset.imageUrl = (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(asset.imageStorageId) })).url ?? asset.imageUrl;
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
}

// Resolve a scanned code to an asset. QR/2D labels encode the asset page URL
// (which contains the asset _id); 1D barcodes encode the plain asset tag. The
// caller extracts the candidate token and we match by id first, then by tag.
export async function resolveScanPortable(
  ctx: PortableQueryCtx,
  { societyId, code }: { societyId: string; code: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const raw = code.trim();
  if (!raw) return null;
  // Pull an /app/assets/<id> id out of a URL if present, else use the raw text.
  const urlMatch = raw.match(/assets\/([a-z0-9]+)/i);
  const candidateId = urlMatch ? urlMatch[1] : raw;
  // Try a direct document lookup (works for QR URLs encoding the _id).
  try {
    const byId = await getOwned(ctx, "assets", candidateId, societyId);
    if (byId) return byId;
  } catch {
    // Not a valid id — fall through to tag lookup.
  }
  // Try the asset tag (1D barcodes, or a tag typed/pasted in).
  const byTag = await ctx.db
    .query("assets")
    .withIndex("by_society_tag", (q) => q.eq("societyId", societyId).eq("assetTag", raw))
    .first();
  return byTag ?? null;
}

export async function receiptLinksPortable(
  ctx: PortableQueryCtx,
  { societyId, receiptDocumentId }: { societyId: string; receiptDocumentId?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  if (receiptDocumentId) {
    await getOwned(ctx, "documents", receiptDocumentId, societyId);
  }
  const rows = receiptDocumentId
    ? await ctx.db
        .query("assetReceiptLinks")
        .withIndex("by_receipt_document", (q) => q.eq("receiptDocumentId", receiptDocumentId))
        .collect()
    : await ctx.db
        .query("assetReceiptLinks")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
  return rows.filter((row) => row.societyId === societyId);
}

export async function eventsPortable(ctx: PortableQueryCtx, { assetId }: { assetId: string }) {
  const asset = await ctx.db.get(assetId, "assets");
  if (!asset) throw new Error("assets not found.");
  await requireSocietyMembership(ctx, String(asset.societyId));
  await getOwned(ctx, "assets", assetId, String(asset.societyId));
  return ctx.db
    .query("assetEvents")
    .withIndex("by_asset_happened", (q) => q.eq("assetId", assetId))
    .order("desc")
    .collect();
}

export async function maintenancePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("assetMaintenance")
    .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function verificationRunsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("assetVerificationRuns")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function verificationItemsPortable(ctx: PortableQueryCtx, { runId }: { runId: string }) {
  const run = await ctx.db.get(runId, "assetVerificationRuns");
  if (!run) throw new Error("assetVerificationRuns not found.");
  await requireSocietyMembership(ctx, String(run.societyId));
  await getOwned(ctx, "assetVerificationRuns", runId, String(run.societyId));
  return ctx.db
    .query("assetVerificationItems")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .collect();
}

/* ----------------------------- Mutations ----------------------------- */

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    assetTag: string;
    preferredLabelType?: string;
    name: string;
    category: string;
    serialNumber?: string;
    supplier?: string;
    purchaseDate?: string;
    purchaseValueCents?: number;
    quantityOnHand?: number;
    quantityUnit?: string;
    currency?: string;
    fundingSource?: string;
    grantId?: string;
    grantRestrictions?: string;
    retentionUntil?: string;
    disposalRules?: string;
    location?: string;
    condition: string;
    status: string;
    custodianType?: string;
    custodianId?: string;
    custodianName?: string;
    responsiblePersonName?: string;
    expectedReturnDate?: string;
    insurancePolicyId?: string;
    insuranceNotes?: string;
    capitalized: boolean;
    depreciationMethod?: string;
    usefulLifeMonths?: number;
    bookValueCents?: number;
    imageStorageId?: string;
    imageUrl?: string;
    clearImage?: boolean;
    purchaseTransactionId?: string;
    clearPurchaseTransaction?: boolean;
    receiptDocumentId?: string;
    clearReceiptDocument?: boolean;
    sourceDocumentIds?: string[];
    resourceLinks?: { label: string; url: string }[];
    warrantyExpiresAt?: string;
    nextMaintenanceDate?: string;
    nextVerificationDate?: string;
    notes?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.grantId) await getOwned(ctx, "grants", args.grantId, args.societyId);
  if (args.insurancePolicyId) {
    await getOwned(ctx, "insurancePolicies", args.insurancePolicyId, args.societyId);
  }
  if (args.purchaseTransactionId) {
    await getOwned(ctx, "financialTransactions", args.purchaseTransactionId, args.societyId);
  }
  if (args.receiptDocumentId) {
    await getOwned(ctx, "documents", args.receiptDocumentId, args.societyId);
  }
  for (const documentId of args.sourceDocumentIds ?? []) {
    await getOwned(ctx, "documents", documentId, args.societyId);
  }
  if (args.imageStorageId) {
    await claimStorageId(ctx, args.imageStorageId, args.societyId);
  }
  const now = new Date().toISOString();
  const tag = args.assetTag.trim();
  if (!tag) throw new Error("Asset tag is required.");
  const existing = await ctx.db
    .query("assets")
    .withIndex("by_society_tag", (q) => q.eq("societyId", args.societyId).eq("assetTag", tag))
    .first();
  if (existing) {
    throw new Error(`Asset tag "${tag}" is already used by ${existing.name}. Choose a unique tag.`);
  }
  const {
    clearImage: _clearImage,
    clearReceiptDocument: _clearReceipt,
    clearPurchaseTransaction: _clearTxn,
    ...insertArgs
  } = args;
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
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action: "created",
    summary: `Created asset ${args.assetTag} — ${args.name}`,
    createdAtISO: now,
  });
  return id;
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: { id: string; patch: Record<string, any> },
) {
  const candidate = await ctx.db.get(id, "assets");
  if (!candidate) throw new Error("assets not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "assets", id, String(candidate.societyId));
  if (patch.grantId) await getOwned(ctx, "grants", patch.grantId, String(candidate.societyId));
  if (patch.insurancePolicyId) {
    await getOwned(ctx, "insurancePolicies", patch.insurancePolicyId, String(candidate.societyId));
  }
  if (patch.purchaseTransactionId) {
    await getOwned(ctx, "financialTransactions", patch.purchaseTransactionId, String(candidate.societyId));
  }
  if (patch.receiptDocumentId) {
    await getOwned(ctx, "documents", patch.receiptDocumentId, String(candidate.societyId));
  }
  for (const documentId of patch.sourceDocumentIds ?? []) {
    await getOwned(ctx, "documents", documentId, String(candidate.societyId));
  }
  if (typeof patch.imageStorageId === "string") {
    await claimStorageId(ctx, patch.imageStorageId, String(candidate.societyId));
  }
  const { clearImage, clearReceiptDocument, clearPurchaseTransaction, ...rest } = patch as any;
  const next: any = { ...rest, updatedAtISO: new Date().toISOString() };
  // Convex patch ignores undefined args, so clearing a linked record needs an explicit signal.
  if (clearImage) {
    next.imageStorageId = undefined;
    next.imageUrl = undefined;
  }
  if (clearReceiptDocument) next.receiptDocumentId = undefined;
  if (clearPurchaseTransaction) next.purchaseTransactionId = undefined;
  if (typeof next.assetTag === "string") {
    const tag = next.assetTag.trim();
    const current = candidate;
    if (current && tag && tag !== current.assetTag) {
      const clash = await ctx.db
        .query("assets")
        .withIndex("by_society_tag", (q) => q.eq("societyId", current.societyId).eq("assetTag", tag))
        .first();
      if (clash && clash._id !== id) {
        throw new Error(`Asset tag "${tag}" is already used by ${clash.name}. Choose a unique tag.`);
      }
    }
    next.assetTag = tag;
  }
  await ctx.db.patch(id, next);
  return id;
}

export async function addConsumableStockPortable(
  ctx: PortableMutationCtx,
  { assetId, observedQuantityBefore, quantityAdded, notes }: {
    assetId: string;
    observedQuantityBefore: number;
    quantityAdded: number;
    notes?: string;
  },
) {
  if (observedQuantityBefore < 0 || quantityAdded < 0) {
    throw new Error("Consumable quantities cannot be negative.");
  }
  const candidate = await ctx.db.get(assetId, "assets");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const asset = await getOwned(ctx, "assets", assetId, String(candidate.societyId));
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
    subjectId: assetId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: assetId,
    action: "stock_intake",
    summary: `Added ${quantityAdded} ${asset.quantityUnit ?? "unit"}${quantityAdded === 1 ? "" : "s"} to ${asset.assetTag}; ${quantityAfter} now on hand`,
    createdAtISO: now,
  });
  return eventId;
}

export async function linkReceiptLinePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    assetId: string;
    receiptDocumentId: string;
    financialTransactionId?: string;
    receiptLineLabel?: string;
    receiptLineIndex?: number;
    quantity?: number;
    unitOfMeasure?: string;
    unitCostCents?: number;
    totalCostCents?: number;
    sourceText?: string;
    notes?: string;
    createInventoryItem?: boolean;
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const asset = await getOwned(ctx, "assets", args.assetId, args.societyId);
  await getOwned(ctx, "documents", args.receiptDocumentId, args.societyId);
  if (args.financialTransactionId) {
    await getOwned(ctx, "financialTransactions", args.financialTransactionId, args.societyId);
  }
  const createdByUserId = await principalUserId(ctx, args.societyId);
  if (args.actingUserId && args.actingUserId !== createdByUserId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
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
    createdByUserId,
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
}

export async function recordEventPortable(
  ctx: PortableMutationCtx,
  { assetId, event }: {
    assetId: string;
    event: {
      eventType: string;
      actorName?: string;
      toCustodianType?: string;
      toCustodianId?: string;
      toCustodianName?: string;
      responsiblePersonName?: string;
      location?: string;
      condition?: string;
      observedQuantityBefore?: number;
      quantityAdded?: number;
      quantityAfter?: number;
      expectedReturnDate?: string;
      acceptanceSignature?: string;
      documentIds?: string[];
      notes?: string;
    };
  },
) {
  const candidate = await ctx.db.get(assetId, "assets");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const asset = await getOwned(ctx, "assets", assetId, String(candidate.societyId));
  for (const documentId of event.documentIds ?? []) {
    await getOwned(ctx, "documents", documentId, String(asset.societyId));
  }
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
    subjectId: assetId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: assetId,
    action: event.eventType,
    summary: `${event.eventType} for asset ${asset.assetTag}`,
    createdAtISO: now,
  });
  return eventId;
}

export async function scheduleMaintenancePortable(
  ctx: PortableMutationCtx,
  args: {
    assetId: string;
    title: string;
    kind: string;
    dueDate: string;
    notes?: string;
    createTask?: boolean;
  },
) {
  const candidate = await ctx.db.get(args.assetId, "assets");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const asset = await getOwned(ctx, "assets", args.assetId, String(candidate.societyId));
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
}

export async function completeMaintenancePortable(
  ctx: PortableMutationCtx,
  args: {
    id: string;
    completedAtISO?: string;
    condition?: string;
    notes?: string;
  },
) {
  const candidate = await ctx.db.get(args.id, "assetMaintenance");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const row = await getOwned(ctx, "assetMaintenance", args.id, String(candidate.societyId));
  await getOwned(ctx, "assets", row.assetId, String(row.societyId));
  if (row.taskId) await getOwned(ctx, "tasks", row.taskId, String(row.societyId));
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
}

export async function startVerificationRunPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    reviewerName?: string;
    notes?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const now = new Date().toISOString();
  const assets = await ctx.db
    .query("assets")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
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
}

export async function verifyAssetPortable(
  ctx: PortableMutationCtx,
  args: {
    itemId: string;
    status: string;
    verifiedByName?: string;
    observedLocation?: string;
    observedCondition?: string;
    notes?: string;
  },
) {
  const candidate = await ctx.db.get(args.itemId, "assetVerificationItems");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const item = await getOwned(
    ctx,
    "assetVerificationItems",
    args.itemId,
    String(candidate.societyId),
  );
  await getOwned(ctx, "assets", item.assetId, String(item.societyId));
  await getOwned(ctx, "assetVerificationRuns", item.runId, String(item.societyId));
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
  // A missing/damaged verification result flags the asset register so it
  // doesn't keep showing as "Available" after a failed physical check.
  const statusFromVerification =
    args.status === "missing" ? "Lost" : args.status === "damaged" || args.status === "location_mismatch" ? "Needs review" : undefined;
  await ctx.db.patch(item.assetId, {
    nextVerificationDate: undefined,
    ...(args.observedLocation ? { location: args.observedLocation } : {}),
    ...(args.observedCondition ? { condition: args.observedCondition } : {}),
    ...(statusFromVerification ? { status: statusFromVerification } : {}),
    updatedAtISO: now,
  });
  const asset = await getOwned(ctx, "assets", item.assetId, String(item.societyId));
  if (asset) {
    const inventoryItem = await ctx.db
      .query("inventoryItems")
      .withIndex("by_asset", (q) => q.eq("assetId", item.assetId))
      .first();
    if (inventoryItem) {
      const run = await getOwned(ctx, "assetVerificationRuns", item.runId, String(item.societyId));
      const counts = run
        ? await ctx.db
            .query("inventoryCounts")
            .withIndex("by_society_status", (q) => q.eq("societyId", item.societyId).eq("status", "open"))
            .collect()
        : [];
      const count = counts.find((row: any) => row.title === run?.title && row.startedAtISO === run?.startedAtISO);
      if (count) {
        const lines = await ctx.db
          .query("inventoryCountLines")
          .withIndex("by_count", (q) => q.eq("inventoryCountId", count._id))
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
}

export async function completeVerificationRunPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
) {
  const candidate = await ctx.db.get(id, "assetVerificationRuns");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const run = await getOwned(ctx, "assetVerificationRuns", id, String(candidate.societyId));
  const now = new Date().toISOString();
  await ctx.db.patch(id, { status: "Completed", completedAtISO: now, updatedAtISO: now });
  if (run) {
    const counts = await ctx.db
      .query("inventoryCounts")
      .withIndex("by_society_status", (q) => q.eq("societyId", run.societyId).eq("status", "open"))
      .collect();
    const count = counts.find((row: any) => row.title === run.title && row.startedAtISO === run.startedAtISO);
    if (count) await ctx.db.patch(count._id, { status: "completed", completedAtISO: now, updatedAtISO: now });
  }
  return id;
}

export async function disposePortable(
  ctx: PortableMutationCtx,
  args: {
    assetId: string;
    disposedAt: string;
    disposalMethod: string;
    disposalReason: string;
    disposalValueCents?: number;
    disposalApprovedMeetingId?: string;
    disposalDocumentIds?: string[];
    notes?: string;
  },
) {
  const candidate = await ctx.db.get(args.assetId, "assets");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const asset = await getOwned(ctx, "assets", args.assetId, String(candidate.societyId));
  if (args.disposalApprovedMeetingId) {
    await getOwned(ctx, "meetings", args.disposalApprovedMeetingId, String(asset.societyId));
  }
  for (const documentId of args.disposalDocumentIds ?? []) {
    await getOwned(ctx, "documents", documentId, String(asset.societyId));
  }
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
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const asset = await ctx.db.get(id, "assets");
  if (!asset) return null;
  await requireSocietyMembership(ctx, String(asset.societyId));
  await getOwned(ctx, "assets", id, String(asset.societyId));
  // Remove dependent records so deleting an asset never leaves orphaned
  // events, maintenance, verification items, or receipt links behind.
  const [events, maintenanceRows, verificationItems, links] = await Promise.all([
    ctx.db.query("assetEvents").withIndex("by_asset", (q) => q.eq("assetId", id)).collect(),
    ctx.db.query("assetMaintenance").withIndex("by_asset", (q) => q.eq("assetId", id)).collect(),
    ctx.db.query("assetVerificationItems").withIndex("by_asset", (q) => q.eq("assetId", id)).collect(),
    ctx.db.query("assetReceiptLinks").withIndex("by_asset", (q) => q.eq("assetId", id)).collect(),
  ]);
  await Promise.all([
    ...events.map((row: any) => ctx.db.delete(row._id)),
    ...maintenanceRows.map((row: any) => ctx.db.delete(row._id)),
    ...verificationItems.map((row: any) => ctx.db.delete(row._id)),
    ...links.map((row: any) => ctx.db.delete(row._id)),
  ]);
  await ctx.db.delete(id);
  return null;
}
