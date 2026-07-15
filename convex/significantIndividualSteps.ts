import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  reviewsDuePortable,
  removePortable,
} from "../shared/functions/significantIndividualSteps";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    individualName: v.string(),
    roleHolderId: v.optional(v.id("roleHolders")),
    stepsNarrative: v.string(),
    stepDate: v.string(),
    nextReviewDate: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const reviewsDue = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => reviewsDuePortable(await toPortableQueryCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("significantIndividualSteps") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
