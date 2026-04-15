import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Build the ≥ $75k remuneration disclosure note (s.36) from employee records
 * for a given fiscal year. Returns rows by position + totals.
 */
export const disclosureForYear = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  handler: async (ctx, { societyId, fiscalYear }) => {
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const earners = employees
      .map((e) => {
        const annual =
          e.annualSalaryCents ??
          (e.hourlyWageCents ? e.hourlyWageCents * 40 * 52 : 0);
        return { role: e.role, amountCents: annual, person: `${e.firstName} ${e.lastName}` };
      })
      .filter((x) => x.amountCents >= 7_500_000)
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 10);
    const totalCents = earners.reduce((s, r) => s + r.amountCents, 0);
    return {
      fiscalYear,
      count: earners.length,
      totalCents,
      byPosition: earners.map((e) => ({ role: e.role, amountCents: e.amountCents })),
    };
  },
});

/** Apply the computed disclosure back onto a financials row. */
export const applyToFinancials = mutation({
  args: {
    financialsId: v.id("financials"),
    disclosures: v.array(v.object({ role: v.string(), amountCents: v.number() })),
  },
  handler: async (ctx, { financialsId, disclosures }) => {
    await ctx.db.patch(financialsId, { remunerationDisclosures: disclosures });
  },
});
