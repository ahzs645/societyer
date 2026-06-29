import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Inventory tables (connections, items, locations, lots, movements, balances, counts, count lines, candidates).
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const inventoryTables = {
  inventoryConnections: defineTable({
    societyId: v.id("societies"),
    provider: v.string(), // openboxes | odoo | erpnext | snipeit | csv | receipt | manual | demo
    displayName: v.string(),
    status: v.string(), // active | needs_attention | disabled
    externalOrganizationId: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    lastSyncedAtISO: v.optional(v.string()),
    settingsJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_provider", ["societyId", "provider"])
    .index("by_society_status", ["societyId", "status"]),

  inventoryItems: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    sku: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    itemType: v.string(), // asset | consumable | supply | software | service | other
    unitOfMeasure: v.string(),
    defaultCostCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    trackSerial: v.boolean(),
    trackLot: v.boolean(),
    trackExpiry: v.boolean(),
    reorderPoint: v.optional(v.number()),
    status: v.string(), // active | archived | needs_review
    assetId: v.optional(v.id("assets")),
    imageStorageId: v.optional(v.id("_storage")),
    imageUrl: v.optional(v.string()),
    externalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    rawJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_sku", ["societyId", "sku"])
    .index("by_society_type", ["societyId", "itemType"])
    .index("by_asset", ["assetId"])
    .index("by_connection_external", ["connectionId", "externalId"]),

  inventoryLocations: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    name: v.string(),
    code: v.optional(v.string()), // human/scannable bin or shelf label, e.g. "BIN-A3"
    locationType: v.string(), // facility | room | shelf | bin | custody | in_transit | vendor | disposed | virtual
    parentLocationId: v.optional(v.id("inventoryLocations")),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    active: v.boolean(),
    // For locationType "custody": who currently holds the items. custodianName
    // mirrors the asset register's custodian vocabulary; custodianMemberId links
    // to a person record when the holder is a known member/director.
    custodianName: v.optional(v.string()),
    custodianMemberId: v.optional(v.id("members")),
    externalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    rawJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "locationType"])
    .index("by_parent", ["parentLocationId"])
    .index("by_connection_external", ["connectionId", "externalId"]),

  inventoryLots: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    inventoryItemId: v.id("inventoryItems"),
    lotNumber: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    manufacturedAt: v.optional(v.string()),
    condition: v.optional(v.string()),
    status: v.string(), // active | depleted | expired | disposed | needs_review
    assetId: v.optional(v.id("assets")),
    externalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    rawJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_item", ["inventoryItemId"])
    .index("by_asset", ["assetId"])
    .index("by_connection_external", ["connectionId", "externalId"]),

  stockMovements: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    movementDate: v.string(),
    movementType: v.string(), // receive | issue | transfer | adjustment | count | consume | return | dispose | reserve | unreserve
    status: v.string(), // draft | posted | void | needs_review
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
    documentIds: v.array(v.id("documents")),
    rawJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society_date", ["societyId", "movementDate"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_item_date", ["inventoryItemId", "movementDate"])
    .index("by_lot", ["inventoryLotId"])
    .index("by_from_location", ["fromLocationId"])
    .index("by_to_location", ["toLocationId"])
    .index("by_asset_event", ["assetEventId"])
    .index("by_connection_external", ["connectionId", "sourceExternalId"]),

  inventoryBalances: defineTable({
    societyId: v.id("societies"),
    inventoryItemId: v.id("inventoryItems"),
    inventoryLotId: v.optional(v.id("inventoryLots")),
    locationId: v.id("inventoryLocations"),
    quantityOnHand: v.number(),
    quantityReserved: v.number(),
    quantityAvailable: v.number(),
    lastMovementId: v.optional(v.id("stockMovements")),
    lastCountedAtISO: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_item", ["inventoryItemId"])
    .index("by_location", ["locationId"])
    .index("by_item_location", ["inventoryItemId", "locationId"]),

  inventoryCounts: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    status: v.string(), // open | completed | void
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    reviewerName: v.optional(v.string()),
    locationId: v.optional(v.id("inventoryLocations")),
    scope: v.optional(v.string()),
    sourceDocumentIds: v.array(v.id("documents")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_location", ["locationId"]),

  inventoryCountLines: defineTable({
    societyId: v.id("societies"),
    inventoryCountId: v.id("inventoryCounts"),
    inventoryItemId: v.id("inventoryItems"),
    inventoryLotId: v.optional(v.id("inventoryLots")),
    locationId: v.id("inventoryLocations"),
    expectedQuantity: v.optional(v.number()),
    countedQuantity: v.optional(v.number()),
    varianceQuantity: v.optional(v.number()),
    condition: v.optional(v.string()),
    status: v.string(), // pending | counted | missing | damaged | adjusted | ignored
    notes: v.optional(v.string()),
    adjustmentMovementId: v.optional(v.id("stockMovements")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_count", ["inventoryCountId"])
    .index("by_item", ["inventoryItemId"])
    .index("by_location", ["locationId"])
    .index("by_count_status", ["inventoryCountId", "status"]),

  inventoryCandidates: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("inventoryConnections")),
    importSessionId: v.optional(v.id("importSessions")),
    candidateType: v.string(), // item | location | lot | movement | count
    sourceSystem: v.string(),
    sourceExternalId: v.optional(v.string()),
    status: v.string(), // new | matched | posted | ignored | needs_review
    occurredAtISO: v.optional(v.string()),
    sku: v.optional(v.string()),
    itemName: v.optional(v.string()),
    locationName: v.optional(v.string()),
    quantity: v.optional(v.number()),
    unitOfMeasure: v.optional(v.string()),
    suggestedInventoryItemId: v.optional(v.id("inventoryItems")),
    suggestedLocationId: v.optional(v.id("inventoryLocations")),
    postedMovementId: v.optional(v.id("stockMovements")),
    rawJson: v.string(),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_import_session", ["importSessionId"])
    .index("by_connection_external", ["connectionId", "sourceExternalId"]),
};
