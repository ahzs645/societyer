import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Filings table.
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const filingTables = {
  filings: defineTable({
    societyId: v.id("societies"),
    kind: v.string(),
    jurisdictionCode: v.optional(v.string()),
    contextKind: v.optional(v.string()),
    sourceRegistrationId: v.optional(v.string()),
    periodLabel: v.optional(v.string()),
    dueDate: v.string(),
    filedAt: v.optional(v.string()),
    submissionMethod: v.optional(v.string()),
    submittedByUserId: v.optional(v.id("users")),
    confirmationNumber: v.optional(v.string()),
    feePaidCents: v.optional(v.number()),
    receiptDocumentId: v.optional(v.id("documents")),
    stagedPacketDocumentId: v.optional(v.id("documents")),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    submissionChecklist: v.optional(v.array(v.string())),
    registryUrl: v.optional(v.string()),
    evidenceNotes: v.optional(v.string()),
    attestedByUserId: v.optional(v.id("users")),
    attestedAtISO: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_due", ["societyId", "dueDate"]),

  // Grants tables (grants, applications, reports, transactions, employee links, sources, source profiles, opportunity candidates), extracted from convex/schema — extracted to convex/tables/grants.ts
};
