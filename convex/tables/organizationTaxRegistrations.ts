import { defineTable } from "convex/server";
import { v } from "convex/values";
import { receiptEvidenceSnapshotValidator } from "../validators/receipts";

export const charityRegistrationStatusValidator = v.union(v.literal("unknown"), v.literal("applied"), v.literal("registered"), v.literal("inactive"));

export const organizationTaxRegistrationTables = {
  organizationTaxRegistrations: defineTable({
    societyId: v.id("societies"),
    registrationType: v.literal("CA-CRA-CHARITY"),
    revisionNumber: v.number(),
    supersedesId: v.optional(v.id("organizationTaxRegistrations")),
    status: charityRegistrationStatusValidator,
    evidenceReviewed: v.boolean(),
    charityNumber: v.optional(v.string()),
    registeredName: v.optional(v.string()),
    registeredAddress: v.optional(v.string()),
    effectiveFrom: v.optional(v.string()),
    effectiveTo: v.optional(v.string()),
    evidenceDocumentIds: v.array(v.id("documents")),
    evidenceSnapshots: v.optional(v.array(receiptEvidenceSnapshotValidator)),
    authorityReference: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Local runtimes can attribute to their explicit workspace-owner principal.
    recordedByUserId: v.string(),
    recordedAtISO: v.string(),
    reviewedByUserId: v.optional(v.string()),
    reviewedAtISO: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  donationReceiptSequences: defineTable({
    societyId: v.id("societies"),
    lastSerial: v.number(),
  }).index("by_society", ["societyId"]),
};
