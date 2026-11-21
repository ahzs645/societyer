// @ts-nocheck
import { authorizedMutation } from "./lib/authorizedServer";
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  createComplianceReviewTaskPortable,
  createPrivacyReviewTaskPortable,
  markPrivacyProgramReviewedPortable,
  markMemberDataAccessReviewedPortable,
  dismissItemPortable,
  acknowledgeItemPortable,
  restoreItemPortable,
} from "../shared/functions/dashboardRemediation";
import { toPortableMutationCtx } from "./lib/portable";

const remediationArgs = {
  societyId: v.id("societies"),
  ruleId: v.string(),
  flagLevel: v.string(),
  flagText: v.string(),
  evidenceRequired: v.array(v.string()),
};

export const createComplianceReviewTask = authorizedMutation("dashboardRemediation:createComplianceReviewTask", mutation)({
  args: {
    ...remediationArgs,
    title: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createComplianceReviewTaskPortable(await toPortableMutationCtx(ctx), args),
});

export const createPrivacyReviewTask = authorizedMutation("dashboardRemediation:createPrivacyReviewTask", mutation)({
  args: {
    ...remediationArgs,
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPrivacyReviewTaskPortable(await toPortableMutationCtx(ctx), args),
});

export const markPrivacyProgramReviewed = authorizedMutation("dashboardRemediation:markPrivacyProgramReviewed", mutation)({
  args: remediationArgs,
  returns: v.any(),
  handler: async (ctx, args) => markPrivacyProgramReviewedPortable(await toPortableMutationCtx(ctx), args),
});

export const markMemberDataAccessReviewed = authorizedMutation("dashboardRemediation:markMemberDataAccessReviewed", mutation)({
  args: remediationArgs,
  returns: v.any(),
  handler: async (ctx, args) => markMemberDataAccessReviewedPortable(await toPortableMutationCtx(ctx), args),
});

// Recommendations only: the handler looks the item up itself and refuses
// statutory, bylaw and internal-policy findings whatever level is sent.
export const dismissItem = authorizedMutation("dashboardRemediation:dismissItem", mutation)({
  args: {
    societyId: v.id("societies"),
    ruleId: v.string(),
    flagLevel: v.optional(v.string()),
    flagText: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => dismissItemPortable(await toPortableMutationCtx(ctx), args),
});

// Records who has seen an outstanding finding; it stays on the dashboard.
export const acknowledgeItem = authorizedMutation("dashboardRemediation:acknowledgeItem", mutation)({
  args: {
    societyId: v.id("societies"),
    ruleId: v.string(),
    flagLevel: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => acknowledgeItemPortable(await toPortableMutationCtx(ctx), args),
});

export const restoreItem = authorizedMutation("dashboardRemediation:restoreItem", mutation)({
  args: { societyId: v.id("societies"), ruleId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => restoreItemPortable(await toPortableMutationCtx(ctx), args),
});
