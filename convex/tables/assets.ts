import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Asset tables (assets, asset events, maintenance, verification runs/items, receipt links), extracted from convex/schema.ts. Spread back into defineSchema; byte-identical.
 */
export const assetTables = {
  assets: defineTable({
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
    custodianType: v.optional(v.string()), // member | director | employee | volunteer | committee | location | other
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
    purchaseTransactionId: v.optional(v.id("financialTransactions")),
    receiptDocumentId: v.optional(v.id("documents")),
    sourceDocumentIds: v.array(v.id("documents")),
    // Supporting documentation for serviceable assets: links to external
    // resources (manufacturer manual, warranty page, support article). Linked
    // documents (uploaded manuals/warranty PDFs) reuse `sourceDocumentIds`.
    resourceLinks: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
    warrantyExpiresAt: v.optional(v.string()),
    nextMaintenanceDate: v.optional(v.string()),
    nextVerificationDate: v.optional(v.string()),
    disposedAt: v.optional(v.string()),
    disposalMethod: v.optional(v.string()),
    disposalReason: v.optional(v.string()),
    disposalValueCents: v.optional(v.number()),
    disposalApprovedMeetingId: v.optional(v.id("meetings")),
    disposalDocumentIds: v.array(v.id("documents")),
    // YCN CORP_ASSETS: named counterparties each side, asset legal situs, and
    // independent acquire vs dispose currency + free-text comments.
    acquiredFrom: v.optional(v.string()),
    disposedTo: v.optional(v.string()),
    assetJurisdiction: v.optional(v.string()),
    acquisitionCurrency: v.optional(v.string()),
    dispositionCurrency: v.optional(v.string()),
    acquisitionComments: v.optional(v.string()),
    dispositionComments: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_tag", ["societyId", "assetTag"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_category", ["societyId", "category"])
    .index("by_grant", ["grantId"])
    .index("by_insurance_policy", ["insurancePolicyId"])
    .index("by_purchase_transaction", ["purchaseTransactionId"])
    .index("by_receipt_document", ["receiptDocumentId"]),

  assetEvents: defineTable({
    societyId: v.id("societies"),
    assetId: v.id("assets"),
    eventType: v.string(), // intake | checkout | checkin | transfer | maintenance | verification | disposal | note
    happenedAtISO: v.string(),
    actorName: v.optional(v.string()),
    fromCustodianName: v.optional(v.string()),
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
    documentIds: v.array(v.id("documents")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_asset", ["assetId"])
    .index("by_asset_happened", ["assetId", "happenedAtISO"])
    .index("by_society_happened", ["societyId", "happenedAtISO"]),

  assetMaintenance: defineTable({
    societyId: v.id("societies"),
    assetId: v.id("assets"),
    title: v.string(),
    kind: v.string(), // maintenance | calibration | insurance | warranty | inspection
    dueDate: v.string(),
    status: v.string(),
    completedAtISO: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_asset", ["assetId"])
    .index("by_society_due", ["societyId", "dueDate"])
    .index("by_task", ["taskId"]),

  assetVerificationRuns: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    status: v.string(),
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    reviewerName: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  assetVerificationItems: defineTable({
    societyId: v.id("societies"),
    runId: v.id("assetVerificationRuns"),
    assetId: v.id("assets"),
    status: v.string(), // pending | verified | missing | damaged | location_mismatch
    verifiedAtISO: v.optional(v.string()),
    verifiedByName: v.optional(v.string()),
    observedLocation: v.optional(v.string()),
    observedCondition: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"])
    .index("by_asset", ["assetId"])
    .index("by_run_status", ["runId", "status"]),

  assetReceiptLinks: defineTable({
    societyId: v.id("societies"),
    assetId: v.optional(v.id("assets")),
    inventoryItemId: v.optional(v.id("inventoryItems")),
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
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_asset", ["assetId"])
    .index("by_inventory_item", ["inventoryItemId"])
    .index("by_receipt_document", ["receiptDocumentId"])
    .index("by_financial_transaction", ["financialTransactionId"]),
};
