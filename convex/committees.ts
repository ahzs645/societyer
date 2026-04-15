import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("committees")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("committees") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const detail = query({
  args: { id: v.id("committees") },
  handler: async (ctx, { id }) => {
    const committee = await ctx.db.get(id);
    if (!committee) return null;
    const [members, meetings, tasks, goals] = await Promise.all([
      ctx.db
        .query("committeeMembers")
        .withIndex("by_committee", (q) => q.eq("committeeId", id))
        .collect(),
      ctx.db
        .query("meetings")
        .withIndex("by_committee", (q) => q.eq("committeeId", id))
        .collect(),
      ctx.db
        .query("tasks")
        .withIndex("by_committee", (q) => q.eq("committeeId", id))
        .collect(),
      ctx.db
        .query("goals")
        .withIndex("by_committee", (q) => q.eq("committeeId", id))
        .collect(),
    ]);
    return { committee, members, meetings, tasks, goals };
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    mission: v.optional(v.string()),
    cadence: v.string(),
    cadenceNotes: v.optional(v.string()),
    chairDirectorId: v.optional(v.id("directors")),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("committees", {
      ...args,
      status: "Active",
      createdAtISO: new Date().toISOString(),
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "committee",
      entityId: id,
      action: "created",
      summary: `Created committee "${args.name}"`,
      createdAtISO: new Date().toISOString(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("committees"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      mission: v.optional(v.string()),
      cadence: v.optional(v.string()),
      cadenceNotes: v.optional(v.string()),
      nextMeetingAt: v.optional(v.string()),
      chairDirectorId: v.optional(v.id("directors")),
      color: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("committees") },
  handler: async (ctx, { id }) => {
    const members = await ctx.db
      .query("committeeMembers")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);
    await ctx.db.delete(id);
  },
});

export const addMember = mutation({
  args: {
    committeeId: v.id("committees"),
    societyId: v.id("societies"),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("committeeMembers", {
      ...args,
      joinedAt: new Date().toISOString().slice(0, 10),
    }),
});

export const removeMember = mutation({
  args: { id: v.id("committeeMembers") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
