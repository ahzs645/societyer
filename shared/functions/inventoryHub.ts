/**
 * PORTABLE FUNCTIONS: the inventory hub domain — connections, items, locations,
 * lots, balances, stock movements, counts, candidates, and receipt links.
 *
 * Reads/writes the inventory* / stockMovements / assetReceiptLinks tables over
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * The `items` query resolves item image blob URLs through the injected
 * `ctx.capabilities.storage` (Convex `_storage` on hosted Convex; an inline/null
 * resolver on the local runtime).
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

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

export async function connectionsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  return ctx.db
    .query("inventoryConnections")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
}

export async function itemsPortable(
  ctx: PortableQueryCtx,
  { societyId, itemType }: { societyId: string; itemType?: string },
) {
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
      imageUrl: row.imageStorageId ? (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(row.imageStorageId) })).url ?? row.imageUrl : row.imageUrl,
    })),
  );
}

export async function locationsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const rows = await ctx.db
    .query("inventoryLocations")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  return rows.sort((a: any, b: any) => a.name.localeCompare(b.name));
}

export async function balancesPortable(
  ctx: PortableQueryCtx,
  { societyId, inventoryItemId }: { societyId: string; inventoryItemId?: string },
) {
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
}

export async function lotsPortable(
  ctx: PortableQueryCtx,
  { societyId, inventoryItemId }: { societyId: string; inventoryItemId?: string },
) {
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
}

export async function stockMovementsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  return ctx.db
    .query("stockMovements")
    .withIndex("by_society_date", (q: any) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 100);
}

export async function receiptLinksPortable(
  ctx: PortableQueryCtx,
  { societyId, inventoryItemId }: { societyId: string; inventoryItemId?: string },
) {
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
}

export async function countsPortable(
  ctx: PortableQueryCtx,
  { societyId, status }: { societyId: string; status?: string },
) {
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
}

export async function upsertConnectionPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    provider: string;
    displayName: string;
    status: string;
    externalOrganizationId?: string;
    baseUrl?: string;
    settingsJson?: string;
  },
) {
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
}

export async function deleteConnectionPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  // Detach any items/locations/movements that referenced this connection so
  // their imported records remain but stop pointing at a deleted library.
  const items = await ctx.db
    .query("inventoryItems")
    .withIndex("by_connection_external", (q: any) => q.eq("connectionId", id))
    .collect();
  for (const item of items) {
    await ctx.db.patch(item._id, { connectionId: undefined, updatedAtISO: new Date().toISOString() });
  }
  await ctx.db.delete(id);
  return null;
}

export async function upsertItemPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    connectionId?: string;
    sku?: string;
    name: string;
    description?: string;
    category: string;
    itemType: string;
    unitOfMeasure: string;
    defaultCostCents?: number;
    currency?: string;
    trackSerial?: boolean;
    trackLot?: boolean;
    trackExpiry?: boolean;
    reorderPoint?: number;
    status?: string;
    assetId?: string;
    imageStorageId?: string;
    imageUrl?: string;
    clearImage?: boolean;
    externalId?: string;
    sourceSystem?: string;
    rawJson?: string;
  },
) {
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
}

export async function upsertLocationPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    connectionId?: string;
    name: string;
    code?: string;
    locationType: string;
    parentLocationId?: string;
    address?: string;
    notes?: string;
    active?: boolean;
    custodianName?: string;
    custodianMemberId?: string;
    externalId?: string;
    sourceSystem?: string;
    rawJson?: string;
  },
) {
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
}

export async function deleteLocationPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
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
}

export async function deleteItemPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
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
}

export async function upsertLotPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    inventoryItemId: string;
    lotNumber?: string;
    serialNumber?: string;
    expiresAt?: string;
    manufacturer?: string;
    manufacturedAt?: string;
    condition?: string;
    status?: string;
    assetId?: string;
    externalId?: string;
    sourceSystem?: string;
    rawJson?: string;
  },
) {
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
}

export async function deleteLotPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const movements = await ctx.db
    .query("stockMovements")
    .withIndex("by_lot", (q: any) => q.eq("inventoryLotId", id))
    .collect();
  if (movements.length > 0) {
    throw new Error("This lot has stock movement history and can't be deleted.");
  }
  await ctx.db.delete(id);
  return { deleted: true };
}

// Start an in-app physical count. Seeds count lines from the current posted
// balances for the chosen scope so a counter can walk a location (or the whole
// catalog) and record what they actually find.
export async function createCountPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    locationId?: string;
    itemType?: string;
    reviewerName?: string;
    notes?: string;
  },
) {
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
}

// Add an item/location pair that wasn't expected (found stock not on the sheet).
export async function addCountLinePortable(
  ctx: PortableMutationCtx,
  args: {
    inventoryCountId: string;
    inventoryItemId: string;
    locationId: string;
    inventoryLotId?: string;
    countedQuantity?: number;
    condition?: string;
    notes?: string;
  },
) {
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
}

export async function setCountLinePortable(
  ctx: PortableMutationCtx,
  args: {
    id: string;
    countedQuantity?: number;
    condition?: string;
    status?: string;
    notes?: string;
  },
) {
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
}

export async function voidCountPortable(
  ctx: PortableMutationCtx,
  { inventoryCountId }: { inventoryCountId: string },
) {
  const now = new Date().toISOString();
  await ctx.db.patch(inventoryCountId, { status: "void", completedAtISO: now, updatedAtISO: now });
  return { voided: true };
}

export async function upsertCandidatePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    connectionId?: string;
    importSessionId?: string;
    candidateType: string;
    sourceSystem: string;
    sourceExternalId?: string;
    occurredAtISO?: string;
    sku?: string;
    itemName?: string;
    locationName?: string;
    quantity?: number;
    unitOfMeasure?: string;
    suggestedInventoryItemId?: string;
    suggestedLocationId?: string;
    rawJson: string;
    notes?: string;
  },
) {
  const now = new Date().toISOString();
  return ctx.db.insert("inventoryCandidates", {
    ...args,
    status: "new",
    createdAtISO: now,
    updatedAtISO: now,
  });
}

// Review queue for imported inventory candidates (the gate before a candidate
// becomes a real stock movement). Optionally filtered by status.
export async function candidatesPortable(
  ctx: PortableQueryCtx,
  { societyId, status }: { societyId: string; status?: string },
) {
  const rows = await ctx.db
    .query("inventoryCandidates")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  const filtered = status ? rows.filter((r: any) => r.status === status) : rows;
  return filtered.sort((a: any, b: any) =>
    String(b.occurredAtISO ?? b.createdAtISO).localeCompare(String(a.occurredAtISO ?? a.createdAtISO)),
  );
}

// Mark a candidate ignored / needs_review / matched without posting it.
export async function setCandidateStatusPortable(
  ctx: PortableMutationCtx,
  { candidateId, status }: { candidateId: string; status: string },
) {
  await ctx.db.patch(candidateId, { status, updatedAtISO: new Date().toISOString() });
  return candidateId;
}

// Promote a reviewed `movement` candidate into a real posted stock movement and
// mark the candidate posted (linking the movement). The destination item must
// be resolved (suggested or overridden); a destination location is required for
// the default "receive".
export async function promoteCandidateToMovementPortable(
  ctx: PortableMutationCtx,
  args: {
    candidateId: string;
    inventoryItemId?: string;
    toLocationId?: string;
    fromLocationId?: string;
    movementType?: string;
  },
) {
  const candidate = await ctx.db.get(args.candidateId);
  if (!candidate) throw new Error("Candidate not found.");
  if (candidate.status === "posted") throw new Error("Candidate has already been posted.");

  const itemId = args.inventoryItemId ?? candidate.suggestedInventoryItemId;
  if (!itemId) throw new Error("Resolve an inventory item before posting this candidate.");
  const item = await ctx.db.get(itemId);
  if (!item || item.societyId !== candidate.societyId) {
    throw new Error("Inventory item must belong to this society.");
  }
  const toLocationId = args.toLocationId ?? candidate.suggestedLocationId;
  if (!toLocationId && !args.fromLocationId) {
    throw new Error("Choose a destination (or source) location for the movement.");
  }
  const quantity = Math.abs(candidate.quantity ?? 0);
  if (quantity <= 0) throw new Error("Candidate has no positive quantity to post.");

  const now = new Date().toISOString();
  const movementId = await ctx.db.insert("stockMovements", {
    societyId: candidate.societyId,
    connectionId: candidate.connectionId,
    movementDate: candidate.occurredAtISO ?? now,
    movementType: args.movementType ?? "receive",
    status: "posted",
    inventoryItemId: itemId,
    fromLocationId: args.fromLocationId,
    toLocationId,
    quantity,
    unitOfMeasure: candidate.unitOfMeasure ?? item.unitOfMeasure ?? "unit",
    reason: candidate.notes,
    sourceExternalId: candidate.sourceExternalId,
    sourceSystem: candidate.sourceSystem ?? "import",
    documentIds: [],
    createdAtISO: now,
    updatedAtISO: now,
  });
  const movement = await ctx.db.get(movementId);
  await postMovementEffects(ctx, movement);
  await ctx.db.patch(args.candidateId, {
    status: "posted",
    postedMovementId: movementId,
    suggestedInventoryItemId: itemId,
    suggestedLocationId: toLocationId,
    updatedAtISO: now,
  });
  return { movementId };
}

export async function linkReceiptPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    inventoryItemId?: string;
    assetId?: string;
    receiptDocumentId?: string;
    financialTransactionId?: string;
    receiptLineLabel?: string;
    receiptLineIndex?: number;
    quantity?: number;
    unitOfMeasure?: string;
    unitCostCents?: number;
    totalCostCents?: number;
    sourceText?: string;
    notes?: string;
    createdByUserId?: string;
  },
) {
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
}

export async function unlinkReceiptPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
  return { deleted: true };
}

export async function postStockMovementPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    connectionId?: string;
    movementDate: string;
    movementType: string;
    status?: string;
    inventoryItemId: string;
    inventoryLotId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    quantity: number;
    unitOfMeasure: string;
    unitCostCents?: number;
    totalCostCents?: number;
    reason?: string;
    reference?: string;
    sourceExternalId?: string;
    sourceSystem?: string;
    assetEventId?: string;
    purchaseTransactionId?: string;
    receiptDocumentId?: string;
    grantId?: string;
    fundRestrictionId?: string;
    documentIds?: string[];
    rawJson?: string;
  },
) {
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
}

export async function postCountVarianceAdjustmentsPortable(
  ctx: PortableMutationCtx,
  { inventoryCountId, reason }: { inventoryCountId: string; reason?: string },
) {
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
}

export async function importOpenBoxesSnapshotPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    connectionId?: string;
    products?: Array<{
      id: string;
      productCode?: string;
      name: string;
      category?: string;
      unitOfMeasure?: string;
      lotAndExpiryControl?: boolean;
      serialized?: boolean;
      rawJson?: string;
    }>;
    locations?: Array<{
      id: string;
      name: string;
      locationType?: string;
      rawJson?: string;
    }>;
    movements?: Array<{
      id: string;
      date: string;
      type: string;
      productId: string;
      originLocationId?: string;
      destinationLocationId?: string;
      quantity: number;
      unitOfMeasure?: string;
      reason?: string;
      rawJson?: string;
    }>;
  },
) {
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
}

export async function createItemFromAssetPortable(
  ctx: PortableMutationCtx,
  { assetId }: { assetId: string },
) {
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
}

export async function recordAssetStockIntakePortable(
  ctx: PortableMutationCtx,
  args: {
    assetId: string;
    assetEventId: string;
    observedQuantityBefore: number;
    quantityAdded: number;
  },
) {
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
}

export async function backfillAssetsPortable(
  ctx: PortableMutationCtx,
  { societyId }: { societyId: string },
) {
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
}
