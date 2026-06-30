import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import {
  listPortable,
  bundlePortable,
  getPortable,
  resolveScanPortable,
  receiptLinksPortable,
  eventsPortable,
  maintenancePortable,
  verificationRunsPortable,
  verificationItemsPortable,
  createPortable,
  updatePortable,
  addConsumableStockPortable,
  linkReceiptLinePortable,
  recordEventPortable,
  scheduleMaintenancePortable,
  completeMaintenancePortable,
  startVerificationRunPortable,
  verifyAssetPortable,
  completeVerificationRunPortable,
  disposePortable,
  removePortable,
} from "../shared/functions/assets";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";

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
  clearPurchaseTransaction: v.optional(v.boolean()),
  receiptDocumentId: v.optional(v.id("documents")),
  clearReceiptDocument: v.optional(v.boolean()),
  sourceDocumentIds: v.optional(v.array(v.id("documents"))),
  resourceLinks: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
  warrantyExpiresAt: v.optional(v.string()),
  nextMaintenanceDate: v.optional(v.string()),
  nextVerificationDate: v.optional(v.string()),
  disposedAt: v.optional(v.string()),
  disposalMethod: v.optional(v.string()),
  disposalReason: v.optional(v.string()),
  disposalValueCents: v.optional(v.number()),
  disposalApprovedMeetingId: v.optional(v.id("meetings")),
  disposalDocumentIds: v.optional(v.array(v.id("documents"))),
  // YCN CORP_ASSETS acquire/dispose detail.
  acquiredFrom: v.optional(v.string()),
  disposedTo: v.optional(v.string()),
  assetJurisdiction: v.optional(v.string()),
  acquisitionCurrency: v.optional(v.string()),
  dispositionCurrency: v.optional(v.string()),
  acquisitionComments: v.optional(v.string()),
  dispositionComments: v.optional(v.string()),
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

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});

export const get = query({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: (ctx, args) => getPortable(toPortableQueryCtx(ctx), args),
});

// Resolve a scanned code to an asset. QR/2D labels encode the asset page URL
// (which contains the asset _id); 1D barcodes encode the plain asset tag. The
// caller extracts the candidate token and we match by id first, then by tag.
export const resolveScan = query({
  args: { societyId: v.id("societies"), code: v.string() },
  returns: v.any(),
  handler: (ctx, args) => resolveScanPortable(toPortableQueryCtx(ctx), args),
});

export const bundle = query({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: (ctx, args) => bundlePortable(toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});

export const receiptLinks = query({
  args: { societyId: v.id("societies"), receiptDocumentId: v.optional(v.id("documents")) },
  returns: v.any(),
  handler: (ctx, args) => receiptLinksPortable(toPortableQueryCtx(ctx), args),
});

export const events = query({
  args: { assetId: v.id("assets") },
  returns: v.any(),
  handler: (ctx, args) => eventsPortable(toPortableQueryCtx(ctx), args),
});

export const maintenance = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => maintenancePortable(toPortableQueryCtx(ctx), args),
});

export const verificationRuns = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => verificationRunsPortable(toPortableQueryCtx(ctx), args),
});

export const verificationItems = query({
  args: { runId: v.id("assetVerificationRuns") },
  returns: v.any(),
  handler: (ctx, args) => verificationItemsPortable(toPortableQueryCtx(ctx), args),
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
    clearPurchaseTransaction: v.optional(v.boolean()),
    receiptDocumentId: v.optional(v.id("documents")),
    clearReceiptDocument: v.optional(v.boolean()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    resourceLinks: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
    warrantyExpiresAt: v.optional(v.string()),
    nextMaintenanceDate: v.optional(v.string()),
    nextVerificationDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: { id: v.id("assets"), patch: assetPatch },
  returns: v.any(),
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const addConsumableStock = mutation({
  args: {
    assetId: v.id("assets"),
    observedQuantityBefore: v.number(),
    quantityAdded: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => addConsumableStockPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => linkReceiptLinePortable(toPortableMutationCtx(ctx), args),
});

export const recordEvent = mutation({
  args: { assetId: v.id("assets"), event: eventInput },
  returns: v.any(),
  handler: (ctx, args) => recordEventPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => scheduleMaintenancePortable(toPortableMutationCtx(ctx), args),
});

export const completeMaintenance = mutation({
  args: {
    id: v.id("assetMaintenance"),
    completedAtISO: v.optional(v.string()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => completeMaintenancePortable(toPortableMutationCtx(ctx), args),
});

export const startVerificationRun = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    reviewerName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => startVerificationRunPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => verifyAssetPortable(toPortableMutationCtx(ctx), args),
});

export const completeVerificationRun = mutation({
  args: { id: v.id("assetVerificationRuns") },
  returns: v.any(),
  handler: (ctx, args) => completeVerificationRunPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => disposePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
