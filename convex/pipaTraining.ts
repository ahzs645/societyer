// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { pipaTrainingList, pipaTrainingCreate, pipaTrainingUpdate, pipaTrainingRemove } from "../shared/functions/pipaTraining";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => pipaTrainingList(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    participantName: v.string(),
    role: v.string(),
    participantEmail: v.optional(v.string()),
    topic: v.string(),
    completedAtISO: v.string(),
    nextDueAtISO: v.optional(v.string()),
    trainer: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => pipaTrainingCreate(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("pipaTrainings"),
    patch: v.object({
      participantName: v.optional(v.string()),
      role: v.optional(v.string()),
      participantEmail: v.optional(v.string()),
      topic: v.optional(v.string()),
      completedAtISO: v.optional(v.string()),
      nextDueAtISO: v.optional(v.string()),
      trainer: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => pipaTrainingUpdate(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("pipaTrainings") },
  returns: v.any(),
  handler: async (ctx, args) => pipaTrainingRemove(await toPortableMutationCtx(ctx), args),
});
