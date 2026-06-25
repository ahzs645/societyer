import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Wave accounting cache tables (snapshots, resources, structures).
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const waveCacheTables = {
  waveCacheSnapshots: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    businessName: v.string(),
    currencyCode: v.optional(v.string()),
    fetchedAtISO: v.string(),
    resourceCountsJson: v.string(),
    resourceTypes: v.array(v.string()),
    structureTypes: v.array(v.string()),
    status: v.string(), // complete | error
    lastError: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_connection", ["connectionId"])
    .index("by_society_provider", ["societyId", "provider"]),

  waveCacheResources: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("waveCacheSnapshots"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    resourceType: v.string(), // business | account | vendor | customer | product | invoice | estimate | salesTax
    externalId: v.optional(v.string()),
    label: v.string(),
    secondaryLabel: v.optional(v.string()),
    typeValue: v.optional(v.string()),
    subtypeValue: v.optional(v.string()),
    status: v.optional(v.string()),
    currencyCode: v.optional(v.string()),
    amountValue: v.optional(v.string()),
    dateValue: v.optional(v.string()),
    searchText: v.string(),
    rawJson: v.string(),
    fetchedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"])
    .index("by_society_type", ["societyId", "resourceType"])
    .index("by_society_external", ["societyId", "externalId"]),

  waveCacheStructures: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("waveCacheSnapshots"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    typeName: v.string(),
    kind: v.string(),
    fieldCount: v.number(),
    fieldsJson: v.string(),
    rawJson: v.string(),
    fetchedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"])
    .index("by_type", ["typeName"]),
};
