import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  reviewsDuePortable,
  removePortable,
  updateDatesPortable,
  transparencyDeadlinesPortable,
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
    stepKind: v.optional(v.union(
      v.literal("annual_review"), v.literal("change"), v.literal("became_significant"),
      v.literal("ceased_significant"), v.literal("information_request"), v.literal("other"),
    )),
    awareOn: v.optional(v.string()),
    recordedOn: v.optional(v.string()),
    notifiedOn: v.optional(v.string()),
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

export const updateDates = authorizedMutation("significantIndividualSteps:updateDates", mutation)({
  args: { id: v.id("significantIndividualSteps"), recordedOn: v.optional(v.string()), notifiedOn: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => updateDatesPortable(await toPortableMutationCtx(ctx), args),
});

export const transparencyDeadlines = authorizedQuery("significantIndividualSteps:transparencyDeadlines", query)({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => transparencyDeadlinesPortable(await toPortableQueryCtx(ctx), args),
});
