import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  recordLayoutGet,
  recordLayoutUpsert,
  recordLayoutRemove,
} from "../shared/functions/recordLayouts";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const get = query({
  args: {
    societyId: v.id("societies"),
    scopeKey: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordLayoutGet(await toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    scopeKey: v.string(),
    layoutJson: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordLayoutUpsert(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: {
    societyId: v.id("societies"),
    scopeKey: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordLayoutRemove(await toPortableMutationCtx(ctx), args),
});
