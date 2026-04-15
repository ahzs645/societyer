import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("auditorAppointments")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    firmName: v.string(),
    engagementType: v.string(),
    fiscalYear: v.string(),
    appointedBy: v.string(),
    appointedAtISO: v.string(),
    engagementLetterDocId: v.optional(v.id("documents")),
    independenceAttested: v.boolean(),
    status: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("auditorAppointments", args),
});

export const update = mutation({
  args: {
    id: v.id("auditorAppointments"),
    patch: v.object({
      firmName: v.optional(v.string()),
      engagementType: v.optional(v.string()),
      fiscalYear: v.optional(v.string()),
      appointedBy: v.optional(v.string()),
      engagementLetterDocId: v.optional(v.id("documents")),
      independenceAttested: v.optional(v.boolean()),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("auditorAppointments") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
