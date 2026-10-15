import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  decideStepPortable,
  markSubmittedPortable,
  progressPortable,
  recordIncorporationPortable,
} from "../shared/functions/organizationSetup";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";

/**
 * Organization setup (`/app/organization-setup`): progress through the
 * formation lifecycle, per-step skip decisions, and the two lifecycle actions
 * (filed with the registry, certificate recorded). One portable handler per
 * function in shared/functions/organizationSetup.ts.
 */
export const progress = authorizedQuery("organizationSetup:progress", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => progressPortable(await toPortableQueryCtx(ctx), args),
});

export const decideStep = authorizedMutation("organizationSetup:decideStep", mutation)({
  args: {
    societyId: v.id("societies"),
    stepKey: v.string(),
    decision: v.union(v.literal("not_applicable"), v.literal("later"), v.null()),
    reason: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => decideStepPortable(await toPortableMutationCtx(ctx), args),
});

export const markSubmitted = authorizedMutation("organizationSetup:markSubmitted", mutation)({
  args: {
    societyId: v.id("societies"),
    submittedOn: v.optional(v.string()),
    reference: v.optional(v.string()),
    undo: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => markSubmittedPortable(await toPortableMutationCtx(ctx), args),
});

export const recordIncorporation = authorizedMutation("organizationSetup:recordIncorporation", mutation)({
  args: {
    societyId: v.id("societies"),
    certificateDocumentId: v.id("documents"),
    certificateReference: v.optional(v.string()),
    certificateDate: v.string(),
    incorporationNumber: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => recordIncorporationPortable(await toPortableMutationCtx(ctx), args),
});
