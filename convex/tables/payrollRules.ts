import { defineTable } from "convex/server";
import { v } from "convex/values";

export const payrollRuleStatusValidator = v.union(
  v.literal("draft"),
  v.literal("reviewed"),
  v.literal("published"),
  v.literal("retired"),
);
export const payrollRuleSourceValidator = v.object({
  authority: v.string(),
  title: v.string(),
  url: v.string(),
  reviewedOn: v.string(),
  notes: v.string(),
});
const bracket = v.object({
  thresholdCents: v.number(),
  rate: v.string(),
  constantCents: v.number(),
});
const archive = v.object({
  file: v.string(),
  url: v.string(),
  sha256: v.string(),
  bytes: v.number(),
});
export const payrollRuleRateSetValidator = v.object({
  year: v.number(),
  province: v.literal("BC"),
  engineVersion: v.string(),
  id: v.string(),
  method: v.union(v.literal("option1"), v.literal("option2")),
  effectiveFrom: v.string(),
  effectiveTo: v.string(),
  rounding: v.string(),
  federal: v.object({
    brackets: v.array(bracket),
    basicPersonalMaximumCents: v.number(),
    basicPersonalMinimumCents: v.number(),
    basicPersonalPhaseOutFromCents: v.number(),
    basicPersonalPhaseOutToCents: v.number(),
    employmentAmountCents: v.number(),
  }),
  provincial: v.object({
    brackets: v.array(bracket),
    basicPersonalCents: v.number(),
    reductionCents: v.number(),
    reductionStartsAtCents: v.number(),
    reductionEndsAtCents: v.number(),
    reductionRate: v.string(),
  }),
  cpp: v.object({
    rate: v.string(),
    baseRate: v.string(),
    additionalRate: v.string(),
    secondRate: v.string(),
    annualExemptionCents: v.number(),
    ympeCents: v.number(),
    yampeCents: v.number(),
    maximumCents: v.number(),
    baseMaximumCents: v.number(),
    additionalMaximumCents: v.number(),
    secondMaximumCents: v.number(),
  }),
  ei: v.object({
    rate: v.string(),
    insurableMaximumCents: v.number(),
    maximumCents: v.number(),
    employerMultiplier: v.string(),
    employerMaximumCents: v.number(),
  }),
  sources: v.array(archive),
  formulaSources: v.array(archive),
});
export const payrollRuleDraftValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  rateSet: payrollRuleRateSetValidator,
  sourceEvidence: v.array(payrollRuleSourceValidator),
});
export const payrollRuleTables = {
  payrollRuleEditions: defineTable({
    societyId: v.id("societies"),
    libraryId: v.string(),
    revision: v.number(),
    status: payrollRuleStatusValidator,
    baseOfficialId: v.string(),
    year: v.number(),
    name: v.string(),
    description: v.optional(v.string()),
    rateSetJson: v.string(),
    sourceEvidence: v.array(payrollRuleSourceValidator),
    contentHash: v.string(),
    createdByUserId: v.string(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    reviewedByUserId: v.optional(v.string()),
    reviewedAtISO: v.optional(v.string()),
    reviewEvidence: v.optional(v.string()),
    publishedByUserId: v.optional(v.string()),
    publishedAtISO: v.optional(v.string()),
    retiredByUserId: v.optional(v.string()),
    retiredAtISO: v.optional(v.string()),
    retirementReason: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_year", ["societyId", "year"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_year_status", ["societyId", "year", "status"])
    .index("by_society_library_revision", [
      "societyId",
      "libraryId",
      "revision",
    ]),
};
