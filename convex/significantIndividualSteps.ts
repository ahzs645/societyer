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
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const reviewsDue = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: (ctx, args) => reviewsDuePortable(toPortableQueryCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("significantIndividualSteps") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
