import { v } from "convex/values";

/**
 * The operative articles of a BC company (shared/operativeArticles.ts). Every
 * field is optional except the base, so existing rows and backups validate.
 * The table definition and the mutation arguments share this validator.
 */
export const operativeArticlesValidator = v.object({
  base: v.union(v.literal("bc_table_1"), v.literal("custom")),
  table1Version: v.optional(v.union(
    v.literal("original_2004"), v.literal("am_315_2004"), v.literal("am_186_2007"),
    v.literal("am_64_2021"), v.literal("am_114_2022"), v.literal("am_50_2023"),
  )),
  table1Incorporation: v.optional(v.union(v.literal("by_reference"), v.literal("reproduced_text"), v.literal("operation_of_act"))),
  adoptedOn: v.optional(v.string()),
  customParts: v.optional(v.array(v.object({ part: v.string(), title: v.string() }))),
  noticeMinDays: v.optional(v.number()),
  specialMajority: v.optional(v.union(v.literal("two_thirds"), v.literal("three_quarters"))),
  shareholderQuorum: v.optional(v.object({
    people: v.number(),
    minVotingSharesNumerator: v.optional(v.number()),
    minVotingSharesDenominator: v.optional(v.number()),
  })),
  boardQuorum: v.optional(v.object({
    quorumType: v.union(v.literal("majority"), v.literal("fixed")),
    quorumValue: v.optional(v.number()),
  })),
  chairCastingVote: v.optional(v.boolean()),
  transferConsentRequired: v.optional(v.boolean()),
  electronicParticipationRestricted: v.optional(v.boolean()),
  directorIndemnity: v.optional(v.union(v.literal("mandatory"), v.literal("permissive"))),
  officerIndemnity: v.optional(v.union(v.literal("mandatory"), v.literal("permissive"))),
  sourceDocumentId: v.optional(v.id("documents")),
  notes: v.optional(v.string()),
  recordedAtISO: v.optional(v.string()),
});
