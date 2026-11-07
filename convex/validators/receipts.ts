import { v } from "convex/values";

export const receiptDocumentKindValidator = v.union(v.literal("acknowledgement"), v.literal("official_tax_receipt"));
export const receiptEvidenceSnapshotValidator = v.object({
  documentId: v.id("documents"), fingerprint: v.string(), documentVersionId: v.optional(v.id("documentVersions")),
  storageId: v.optional(v.id("_storage")), fileName: v.optional(v.string()), mimeType: v.optional(v.string()),
  sha256: v.optional(v.string()), fileSizeBytes: v.optional(v.number()),
});
export const receiptIssuerSnapshotValidator = v.object({
  name: v.string(), address: v.string(),
  charityNumber: v.optional(v.string()),
  registrationRevisionId: v.optional(v.id("organizationTaxRegistrations")),
  registrationEffectiveFrom: v.optional(v.string()),
  registrationEffectiveTo: v.optional(v.string()),
  evidenceDocumentIds: v.optional(v.array(v.id("documents"))),
  evidenceSnapshots: v.optional(v.array(receiptEvidenceSnapshotValidator)),
});
export const receiptGiftAssessmentValidator = v.object({
  ruleVersion: v.string(), giftType: v.literal("cash"), advantageAmountCents: v.number(), eligibleAmountCents: v.number(),
  eligibilityConfirmedByUserId: v.string(), assessedAtISO: v.string(),
});
export const receiptSignedCopyValidator = v.object({
  documentId: v.id("documents"), documentVersionId: v.optional(v.id("documentVersions")), storageId: v.optional(v.id("_storage")),
  fileName: v.string(), mimeType: v.string(), sha256: v.optional(v.string()), fingerprint: v.string(), fileSizeBytes: v.optional(v.number()),
});
