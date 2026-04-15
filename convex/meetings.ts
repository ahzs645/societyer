import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("meetings")
      .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
      .order("desc")
      .collect(),
});

export const get = query({
  args: { id: v.id("meetings") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    type: v.string(),
    title: v.string(),
    scheduledAt: v.string(),
    location: v.optional(v.string()),
    electronic: v.boolean(),
    quorumRequired: v.optional(v.number()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    agendaJson: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("meetings", args),
});

export const update = mutation({
  args: {
    id: v.id("meetings"),
    patch: v.object({
      type: v.optional(v.string()),
      title: v.optional(v.string()),
      scheduledAt: v.optional(v.string()),
      location: v.optional(v.string()),
      electronic: v.optional(v.boolean()),
      noticeSentAt: v.optional(v.string()),
      quorumRequired: v.optional(v.number()),
      status: v.optional(v.string()),
      attendeeIds: v.optional(v.array(v.string())),
      agendaJson: v.optional(v.string()),
      minutesId: v.optional(v.id("minutes")),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("meetings") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
