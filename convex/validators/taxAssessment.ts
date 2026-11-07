import { v } from "convex/values";

/** Additive schema: existing manual-rate lines need no migration. Shared logic validates answers and recomputes decisions. */
export const taxAssessmentValidator = v.object({
  schemaVersion: v.literal(1), rulePackId: v.string(), rulePackVersion: v.string(), rulesReviewedOn: v.string(),
  answers: v.record(v.string(), v.string()),
  components: v.array(v.object({
    taxId: v.string(), label: v.string(),
    treatment: v.union(v.literal("standard"), v.literal("zero_rated"), v.literal("exempt"), v.literal("out_of_scope"), v.literal("not_subject"), v.literal("relieved"), v.literal("review_required")),
    collection: v.union(v.literal("collect"), v.literal("do_not_collect"), v.literal("review_required")),
    ratePercent: v.optional(v.number()), reason: v.string(), authorityIds: v.array(v.string()),
  })),
  issues: v.array(v.string()), status: v.union(v.literal("ready"), v.literal("review_required")), confirmed: v.boolean(),
});
