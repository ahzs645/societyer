import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  listDecisionsPortable,
  markReviewedPortable,
  dismissDecisionPortable,
  reopenDecisionPortable,
} from "../shared/functions/complianceObligations";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const decisionArgs = {
  societyId: v.id("societies"),
  ruleId: v.string(),
  flagLevel: v.string(),
  flagText: v.string(),
  evidenceRequired: v.array(v.string()),
};

export const listDecisions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listDecisionsPortable(await toPortableQueryCtx(ctx), args),
});

export const markReviewed = mutation({
  args: {
    ...decisionArgs,
    notes: v.optional(v.string()),
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => markReviewedPortable(await toPortableMutationCtx(ctx), args),
});

export const dismissDecision = mutation({
  args: {
    ...decisionArgs,
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => dismissDecisionPortable(await toPortableMutationCtx(ctx), args),
});

export const reopenDecision = mutation({
  args: decisionArgs,
  returns: v.any(),
  handler: async (ctx, args) => reopenDecisionPortable(await toPortableMutationCtx(ctx), args),
});
