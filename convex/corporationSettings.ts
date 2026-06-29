import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { complianceDeadlinesPortable } from "../shared/functions/corporationSettings";
import { toPortableQueryCtx } from "./lib/portable";

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
  handler: (ctx, args) => complianceDeadlinesPortable(toPortableQueryCtx(ctx), args),
});
