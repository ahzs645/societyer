import { v } from "convex/values";

/**
 * Organization-profile fields for governing-document and privacy-policy
 * evidence (shared/governingDocumentEvidence.ts). All optional and additive:
 * existing workspaces read as "nothing recorded".
 */
const evidenceField = v.union(v.literal("constitutionDocId"), v.literal("bylawsDocId"), v.literal("privacyPolicyDocId"));

export const governingDocumentEvidenceValidators = {
  // The authoritative copy held outside Societyer, one entry per field. An
  // uploaded link (constitutionDocId / bylawsDocId / privacyPolicyDocId) wins.
  governingDocumentEvidence: v.optional(v.array(v.object({
    field: evidenceField,
    kind: v.union(v.literal("external"), v.literal("physical")),
    reference: v.string(),
    custodian: v.optional(v.string()),
    version: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    recordedAtISO: v.string(),
    recordedByUserId: v.optional(v.string()),
    recordedByName: v.optional(v.string()),
  }))),
  // "Verified current as of <date> by <name>", one per field, tied to the copy it verified.
  governingDocumentVerifications: v.optional(v.array(v.object({
    field: evidenceField,
    verifiedAsOf: v.string(),
    versionReference: v.optional(v.string()),
    notes: v.optional(v.string()),
    evidenceKind: v.union(v.literal("document"), v.literal("external"), v.literal("physical")),
    documentId: v.optional(v.string()),
    evidenceRecordedAtISO: v.optional(v.string()),
    recordedAtISO: v.string(),
    verifiedByUserId: v.optional(v.string()),
    verifiedByName: v.optional(v.string()),
  }))),
  // The latest privacy review attestation; earlier ones stay in the activity log.
  privacyProgramReview: v.optional(v.object({
    policiesReviewed: v.string(),
    versionOrEffectiveDate: v.optional(v.string()),
    maintainedAt: v.optional(v.string()),
    unresolvedFindings: v.optional(v.string()),
    // False when the findings are minor follow-ups with the program in place;
    // absent on older reviews, which count as blocking.
    findingsBlocking: v.optional(v.boolean()),
    reviewedOn: v.string(),
    reviewedAtISO: v.string(),
    reviewedByUserId: v.optional(v.string()),
    reviewedByName: v.optional(v.string()),
  })),
};
