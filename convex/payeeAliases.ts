import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { listPortable, upsertPortable, removePortable } from "../shared/functions/payeeAliases";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// Payee rename rules: raw bank payee -> the name shown in transaction lists.
export const list = authorizedQuery("payeeAliases:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("payeeAliases:upsert", mutation)({
  args: {
    id: v.optional(v.id("payeeAliases")),
    societyId: v.id("societies"),
    match: v.string(),
    matchType: v.union(v.literal("exact"), v.literal("contains")),
    displayName: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("payeeAliases:remove", mutation)({
  args: { id: v.id("payeeAliases"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
