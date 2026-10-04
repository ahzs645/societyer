import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  reviewsDuePortable,
  removePortable,
} from "../shared/functions/significantIndividualSteps";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("significantIndividualSteps:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("significantIndividualSteps:create", mutation)({
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

export const reviewsDue = authorizedQuery("significantIndividualSteps:reviewsDue", query)({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => reviewsDuePortable(await toPortableQueryCtx(ctx), args),
});

export const remove = authorizedMutation("significantIndividualSteps:remove", mutation)({
  args: { id: v.id("significantIndividualSteps") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
