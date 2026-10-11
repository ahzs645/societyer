import { v } from "convex/values";

/** A review records the legal basis; it never supplies the voting weights. */
export const corporateElectionReviewValidator = v.object({
  recordDateISO: v.string(),
  recordDateSource: v.optional(v.union(v.literal("fixed"), v.literal("statutory_default"))),
  recordDateBasis: v.string(),
  rightsBasis: v.string(),
  ledgerBasis: v.string(),
  votingMethod: v.union(v.literal("per_share"), v.literal("cumulative")),
  classIds: v.optional(v.array(v.id("rightsClasses"))),
  representatives: v.array(v.object({
    roleHolderId: v.id("roleHolders"),
    userId: v.id("users"),
    authorityBasis: v.string(),
    authorityDocumentId: v.optional(v.id("documents")),
  })),
});
