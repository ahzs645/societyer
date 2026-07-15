import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import {
  connectionsPortable,
  itemsPortable,
  locationsPortable,
  balancesPortable,
  lotsPortable,
  stockMovementsPortable,
  receiptLinksPortable,
  countsPortable,
  candidatesPortable,
  upsertConnectionPortable,
  deleteConnectionPortable,
  upsertItemPortable,
  upsertLocationPortable,
  deleteLocationPortable,
  deleteItemPortable,
  upsertLotPortable,
  deleteLotPortable,
  createCountPortable,
  addCountLinePortable,
  setCountLinePortable,
  voidCountPortable,
  upsertCandidatePortable,
  setCandidateStatusPortable,
  promoteCandidateToMovementPortable,
  linkReceiptPortable,
  unlinkReceiptPortable,
  postStockMovementPortable,
  postCountVarianceAdjustmentsPortable,
  importOpenBoxesSnapshotPortable,
  createItemFromAssetPortable,
  recordAssetStockIntakePortable,
  backfillAssetsPortable,
} from "../shared/functions/inventoryHub";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";

export const connections = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => connectionsPortable(await toPortableQueryCtx(ctx), args),
});

// Resolves item image blob URLs through the injected storage capability.
export const items = query({
  args: { societyId: v.id("societies"), itemType: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => itemsPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});

export const locations = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => locationsPortable(await toPortableQueryCtx(ctx), args),
});

export const balances = query({
  args: { societyId: v.id("societies"), inventoryItemId: v.optional(v.id("inventoryItems")) },
  returns: v.any(),
  handler: async (ctx, args) => balancesPortable(await toPortableQueryCtx(ctx), args),
});

export const lots = query({
  args: { societyId: v.id("societies"), inventoryItemId: v.optional(v.id("inventoryItems")) },
  returns: v.any(),
  handler: async (ctx, args) => lotsPortable(await toPortableQueryCtx(ctx), args),
});

export const stockMovements = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => stockMovementsPortable(await toPortableQueryCtx(ctx), args),
});

export const receiptLinks = query({
  args: { societyId: v.id("societies"), inventoryItemId: v.optional(v.id("inventoryItems")) },
  returns: v.any(),
  handler: async (ctx, args) => receiptLinksPortable(await toPortableQueryCtx(ctx), args),
});

export const counts = query({
  args: { societyId: v.id("societies"), status: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => countsPortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => upsertConnectionPortable(await toPortableMutationCtx(ctx), args),
});

export const deleteConnection = mutation({
  args: { id: v.id("inventoryConnections") },
  returns: v.any(),
  handler: async (ctx, args) => deleteConnectionPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => upsertItemPortable(await toPortableMutationCtx(ctx), args),
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
    custodianName: v.optional(v.string()),
    custodianMemberId: v.optional(v.id("members")),
    externalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    rawJson: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertLocationPortable(await toPortableMutationCtx(ctx), args),
});

export const deleteLocation = mutation({
  args: { id: v.id("inventoryLocations") },
  returns: v.any(),
  handler: async (ctx, args) => deleteLocationPortable(await toPortableMutationCtx(ctx), args),
});

export const deleteItem = mutation({
  args: { id: v.id("inventoryItems") },
  returns: v.any(),
  handler: async (ctx, args) => deleteItemPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => upsertLotPortable(await toPortableMutationCtx(ctx), args),
});

export const deleteLot = mutation({
  args: { id: v.id("inventoryLots") },
  returns: v.any(),
  handler: async (ctx, args) => deleteLotPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => createCountPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => addCountLinePortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => setCountLinePortable(await toPortableMutationCtx(ctx), args),
});

export const voidCount = mutation({
  args: { inventoryCountId: v.id("inventoryCounts") },
  returns: v.any(),
  handler: async (ctx, args) => voidCountPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => upsertCandidatePortable(await toPortableMutationCtx(ctx), args),
});

// Review queue for imported inventory candidates (the gate before a candidate
// becomes a real stock movement). Optionally filtered by status.
export const candidates = query({
  args: { societyId: v.id("societies"), status: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => candidatesPortable(await toPortableQueryCtx(ctx), args),
});

// Mark a candidate ignored / needs_review / matched without posting it.
export const setCandidateStatus = mutation({
  args: { candidateId: v.id("inventoryCandidates"), status: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => setCandidateStatusPortable(await toPortableMutationCtx(ctx), args),
});

// Promote a reviewed `movement` candidate into a real posted stock movement and
// mark the candidate posted (linking the movement). The destination item must
// be resolved (suggested or overridden); a destination location is required for
// the default "receive".
export const promoteCandidateToMovement = mutation({
  args: {
    candidateId: v.id("inventoryCandidates"),
    inventoryItemId: v.optional(v.id("inventoryItems")),
    toLocationId: v.optional(v.id("inventoryLocations")),
    fromLocationId: v.optional(v.id("inventoryLocations")),
    movementType: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => promoteCandidateToMovementPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => linkReceiptPortable(await toPortableMutationCtx(ctx), args),
});

export const unlinkReceipt = mutation({
  args: { id: v.id("assetReceiptLinks") },
  returns: v.any(),
  handler: async (ctx, args) => unlinkReceiptPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => postStockMovementPortable(await toPortableMutationCtx(ctx), args),
});

export const postCountVarianceAdjustments = mutation({
  args: {
    inventoryCountId: v.id("inventoryCounts"),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => postCountVarianceAdjustmentsPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => importOpenBoxesSnapshotPortable(await toPortableMutationCtx(ctx), args),
});

export const createItemFromAsset = mutation({
  args: { assetId: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, args) => createItemFromAssetPortable(await toPortableMutationCtx(ctx), args),
});

export const recordAssetStockIntake = mutation({
  args: {
    assetId: v.id("assets"),
    assetEventId: v.id("assetEvents"),
    observedQuantityBefore: v.number(),
    quantityAdded: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordAssetStockIntakePortable(await toPortableMutationCtx(ctx), args),
});

export const backfillAssets = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => backfillAssetsPortable(await toPortableMutationCtx(ctx), args),
});
