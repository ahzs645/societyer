// @ts-nocheck
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  createComplianceReviewTaskPortable,
  createPrivacyReviewTaskPortable,
  markPrivacyProgramReviewedPortable,
  markMemberDataAccessReviewedPortable,
} from "../shared/functions/dashboardRemediation";
import { toPortableMutationCtx } from "./lib/portable";

const remediationArgs = {
  societyId: v.id("societies"),
  ruleId: v.string(),
  flagLevel: v.string(),
  flagText: v.string(),
  evidenceRequired: v.array(v.string()),
};

export const createComplianceReviewTask = mutation({
  args: {
    ...remediationArgs,
    title: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createComplianceReviewTaskPortable(await toPortableMutationCtx(ctx), args),
});

export const createPrivacyReviewTask = mutation({
  args: {
    ...remediationArgs,
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPrivacyReviewTaskPortable(await toPortableMutationCtx(ctx), args),
});

export const markPrivacyProgramReviewed = mutation({
  args: remediationArgs,
  returns: v.any(),
  handler: async (ctx, args) => markPrivacyProgramReviewedPortable(await toPortableMutationCtx(ctx), args),
});

export const markMemberDataAccessReviewed = mutation({
  args: remediationArgs,
  returns: v.any(),
  handler: async (ctx, args) => markMemberDataAccessReviewedPortable(await toPortableMutationCtx(ctx), args),
});
