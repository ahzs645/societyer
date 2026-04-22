import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("directorAttestations")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const forDirector = query({
  args: { directorId: v.id("directors") },
  returns: v.any(),
  handler: async (ctx, { directorId }) =>
    ctx.db
      .query("directorAttestations")
      .withIndex("by_director", (q) => q.eq("directorId", directorId))
      .collect(),
});

export const sign = mutation({
  args: {
    societyId: v.id("societies"),
    directorId: v.id("directors"),
    year: v.number(),
    isAtLeast18: v.boolean(),
    notBankrupt: v.boolean(),
    notDisqualified: v.boolean(),
    stillResidentOrEligible: v.boolean(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Upsert by (director, year)
    const existing = await ctx.db
      .query("directorAttestations")
      .withIndex("by_director_year", (q) =>
        q.eq("directorId", args.directorId).eq("year", args.year),
      )
      .collect();
    const payload = { ...args, signedAtISO: new Date().toISOString() };
    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, payload);
      return existing[0]._id;
    }
    return ctx.db.insert("directorAttestations", payload);
  },
});

export const remove = mutation({
  args: { id: v.id("directorAttestations") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/** Returns directors who haven't attested for the current year. */
export const missingForYear = query({
  args: { societyId: v.id("societies"), year: v.number() },
  returns: v.any(),
  handler: async (ctx, { societyId, year }) => {
    const [directors, atts] = await Promise.all([
      ctx.db
        .query("directors")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("directorAttestations")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
    ]);
    const signed = new Set(
      atts.filter((a) => a.year === year).map((a) => a.directorId as string),
    );
    return directors
      .filter((d) => d.status === "Active" && !signed.has(d._id as any))
      .map((d) => ({ _id: d._id, name: `${d.firstName} ${d.lastName}`, position: d.position }));
  },
});
