import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  getPortable,
  byCommitteePortable,
  createPortable,
  updatePortable,
  toggleMilestonePortable,
  removePortable,
} from "../shared/functions/goals";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

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
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("goals") },
  returns: v.any(),
  handler: (ctx, args) => getPortable(toPortableQueryCtx(ctx), args),
});

export const byCommittee = query({
  args: { committeeId: v.id("committees") },
  returns: v.any(),
  handler: (ctx, args) => byCommitteePortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const toggleMilestone = mutation({
  args: { id: v.id("goals"), index: v.number() },
  returns: v.any(),
  handler: (ctx, args) => toggleMilestonePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("goals") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
