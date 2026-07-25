import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { disclosureForYearPortable, applyToFinancialsPortable } from "../shared/functions/remuneration";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Build the ≥ $75k remuneration disclosure note (s.36) from employee records
 * for a given fiscal year. Returns rows by position + totals.
 */
export const disclosureForYear = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => disclosureForYearPortable(await toPortableQueryCtx(ctx), args),
});

/** Apply the computed disclosure back onto a financials row. */
export const applyToFinancials = mutation({
  args: {
    financialsId: v.id("financials"),
    disclosures: v.array(v.object({ role: v.string(), amountCents: v.number() })),
  },
  returns: v.any(),
  handler: async (ctx, args) => applyToFinancialsPortable(await toPortableMutationCtx(ctx), args),
});
