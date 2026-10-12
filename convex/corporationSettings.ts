import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  complianceDeadlinesPortable,
  recordAnnualDeadlineCalendarReviewPortable,
  recordWrittenAnnualBusinessCompletionPortable,
  updateAnnualEvidenceSettingsPortable,
  updateOperativeArticlesPortable,
} from "../shared/functions/corporationSettings";
import { operativeArticlesValidator } from "./validators/operativeArticles";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";

/**
 * Derive compliance deadlines (AGM / fiscal-year-end / annual report) from a
 * society's settings and recorded evidence — the YCN Corporation_Settings →
 * deadlines idea. Built from the same evidence adapter as the Compliance
 * settings page. All date math lives in the pure, unit-tested
 * shared/corporationSettings.ts.
 */
export const complianceDeadlines = authorizedQuery("corporationSettings:complianceDeadlines", query)({
  args: { societyId: v.id("societies"), fromISO: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => complianceDeadlinesPortable(await toPortableQueryCtx(ctx), args),
});

/** Record a reviewed holiday/office calendar for one calculated annual boundary. */
export const recordAnnualDeadlineCalendarReview = authorizedMutation("corporationSettings:recordAnnualDeadlineCalendarReview", mutation)({
  args: {
    societyId: v.id("societies"),
    obligation: v.union(v.literal("annual_meeting"), v.literal("annual_return")),
    cycleYear: v.number(),
    nominalDueDate: v.string(),
    reviewedDueDate: v.string(),
    calendarBasis: v.string(),
    evidenceRef: v.string(),
    channel: v.optional(v.string()),
    reviewedOn: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordAnnualDeadlineCalendarReviewPortable(await toPortableMutationCtx(ctx), args),
});

/** Record a carried written resolution that disposed of the annual meeting's business. */
export const recordWrittenAnnualBusinessCompletion = authorizedMutation("corporationSettings:recordWrittenAnnualBusinessCompletion", mutation)({
  args: {
    societyId: v.id("societies"),
    writtenResolutionId: v.id("writtenResolutions"),
    kind: v.union(v.literal("written_annual_business"), v.literal("written_waiver")),
    completedOn: v.string(),
    cycleYear: v.optional(v.number()),
    annualReferenceDate: v.optional(v.string()),
    financialYearEnd: v.optional(v.string()),
    annualBusinessEvidence: v.string(),
    annualBusinessReviewed: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordWrittenAnnualBusinessCompletionPortable(await toPortableMutationCtx(ctx), args),
});

/** Actual financial/taxation periods for the CBCA meeting and Ontario return calculations. */
export const updateAnnualEvidenceSettings = authorizedMutation("corporationSettings:updateAnnualEvidenceSettings", mutation)({
  args: {
    societyId: v.id("societies"),
    annualMeetingFinancialYearEnd: v.optional(v.union(v.string(), v.null())),
    annualReturnPeriodEnd: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateAnnualEvidenceSettingsPortable(await toPortableMutationCtx(ctx), args),
});

/** Which articles a BC company adopted (Table 1 version or custom), custom Parts and overrides. */
export const updateOperativeArticles = authorizedMutation("corporationSettings:updateOperativeArticles", mutation)({
  args: {
    societyId: v.id("societies"),
    operativeArticles: v.union(operativeArticlesValidator, v.null()),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateOperativeArticlesPortable(await toPortableMutationCtx(ctx), args as any),
});
