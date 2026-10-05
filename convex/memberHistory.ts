import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import * as handlers from "../shared/functions/memberHistory";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
export const list = authorizedQuery("memberHistory:list", query)({
  args: { societyId: v.id("societies"), memberId: v.id("members") }, returns: v.any(),
  handler: async (ctx, args) => handlers.list(await toPortableQueryCtx(ctx), args),
});
export const add = authorizedMutation("memberHistory:add", mutation)({
  args: { societyId: v.id("societies"), memberId: v.id("members"), event: v.object({
    effectiveDate: v.string(), endDate: v.optional(v.string()), kind: v.string(), title: v.string(),
    details: v.optional(v.string()), reviewStatus: v.string(), sourceUrl: v.optional(v.string()),
    sourceReference: v.optional(v.string()), sourceExternalId: v.optional(v.string()),
  }) }, returns: v.any(), handler: async (ctx, args) => handlers.add(await toPortableMutationCtx(ctx), args),
});
