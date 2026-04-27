import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";

const milestone = v.object({
  title: v.string(),
  done: v.boolean(),
  dueDate: v.optional(v.string()),
});
const keyResult = v.object({
  description: v.string(),
  currentValue: v.number(),
  targetValue: v.number(),
  unit: v.string(),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("goals")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("goals") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const byCommittee = query({
  args: { committeeId: v.id("committees") },
  returns: v.any(),
  handler: async (ctx, { committeeId }) =>
    ctx.db
      .query("goals")
      .withIndex("by_committee", (q) => q.eq("committeeId", committeeId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    title: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    status: v.string(),
    startDate: v.string(),
    targetDate: v.string(),
    progressPercent: v.number(),
    ownerName: v.optional(v.string()),
    milestones: v.array(milestone),
    keyResults: v.array(keyResult),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("goals", {
      ...args,
      createdAtISO: new Date().toISOString(),
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "goal",
      entityId: id,
      action: "created",
      summary: `Created goal "${args.title}"`,
      createdAtISO: new Date().toISOString(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("goals"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      category: v.optional(v.string()),
      status: v.optional(v.string()),
      startDate: v.optional(v.string()),
      targetDate: v.optional(v.string()),
      progressPercent: v.optional(v.number()),
      ownerName: v.optional(v.string()),
      milestones: v.optional(v.array(milestone)),
      keyResults: v.optional(v.array(keyResult)),
      committeeId: v.optional(v.id("committees")),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const toggleMilestone = mutation({
  args: { id: v.id("goals"), index: v.number() },
  returns: v.any(),
  handler: async (ctx, { id, index }) => {
    const goal = await ctx.db.get(id);
    if (!goal) return;
    const milestones = [...goal.milestones];
    milestones[index] = { ...milestones[index], done: !milestones[index].done };
    const pct = Math.round(
      (milestones.filter((m) => m.done).length / Math.max(milestones.length, 1)) * 100,
    );
    await ctx.db.patch(id, { milestones, progressPercent: pct });
  },
});

export const remove = mutation({
  args: { id: v.id("goals") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
