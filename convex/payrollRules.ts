import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import {
  payrollRuleDraftValidator,
  payrollRuleStatusValidator,
} from "./tables/payrollRules";
import * as handlers from "../shared/functions/payrollRules";
const societyId = v.id("societies"),
  id = v.id("payrollRuleEditions");
export const workspace = authorizedQuery(
  "payrollRules:workspace",
  query,
)({
  args: {
    societyId,
    cursor: v.optional(v.union(v.string(), v.null())),
    status: v.optional(payrollRuleStatusValidator),
    year: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) =>
    handlers.workspacePortable(await toPortableQueryCtx(ctx), args),
});
export const get = authorizedQuery(
  "payrollRules:get",
  query,
)({
  args: { societyId, id },
  returns: v.any(),
  handler: async (ctx, args) =>
    handlers.getPortable(await toPortableQueryCtx(ctx), args),
});
export const saveDraft = authorizedMutation(
  "payrollRules:saveDraft",
  mutation,
)({
  args: {
    societyId,
    id: v.optional(id),
    sourceId: v.optional(id),
    baseOfficialId: v.optional(v.string()),
    expectedHash: v.optional(v.string()),
    fields: payrollRuleDraftValidator,
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.saveDraftPortable(await toPortableMutationCtx(ctx), args),
});
export const review = authorizedMutation(
  "payrollRules:review",
  mutation,
)({
  args: {
    societyId,
    id,
    expectedHash: v.string(),
    evidence: v.string(),
    confirmed: v.boolean(),
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.reviewPortable(await toPortableMutationCtx(ctx), args),
});
export const publish = authorizedMutation(
  "payrollRules:publish",
  mutation,
)({
  args: { societyId, id, expectedHash: v.string() },
  returns: id,
  handler: async (ctx, args) =>
    handlers.publishPortable(await toPortableMutationCtx(ctx), args),
});
export const retire = authorizedMutation(
  "payrollRules:retire",
  mutation,
)({
  args: { societyId, id, reason: v.string() },
  returns: id,
  handler: async (ctx, args) =>
    handlers.retirePortable(await toPortableMutationCtx(ctx), args),
});
