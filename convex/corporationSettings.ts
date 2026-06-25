import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  deriveComplianceDeadlines,
  type ComplianceSettings,
} from "../shared/corporationSettings";

/**
 * Derive compliance deadlines (AGM / fiscal-year-end / annual report) from a
 * society's settings — the YCN Corporation_Settings → deadlines idea.
 *
 * Reads the EXISTING societies fields (fiscalYearEnd, anniversaryDate,
 * incorporationDate); the optional agmMonth/agmDay enrich the AGM deadline once
 * those columns are added. All date math lives in the pure, unit-tested
 * shared/corporationSettings.ts.
 */
export const complianceDeadlines = query({
  args: { societyId: v.id("societies"), fromISO: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, fromISO }) => {
    const society = await ctx.db.get(societyId);
    if (!society) return [];
    const settings: ComplianceSettings = {
      agmMonth: (society as Record<string, unknown>).agmMonth as number | undefined,
      agmDay: (society as Record<string, unknown>).agmDay as number | undefined,
      fiscalYearEnd: society.fiscalYearEnd ?? undefined,
      incorporationDate: society.incorporationDate ?? undefined,
      anniversaryDate: society.anniversaryDate ?? undefined,
      waivePrepFinancials: (society as Record<string, unknown>).waivePrepFinancials as
        | boolean
        | undefined,
    };
    return deriveComplianceDeadlines(settings, fromISO);
  },
});
