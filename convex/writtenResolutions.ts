import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  signPortable,
  markFailedPortable,
  removePortable,
} from "../shared/functions/writtenResolutions";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    text: v.string(),
    kind: v.string(),
    requiredCount: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const sign = mutation({
  args: {
    id: v.id("writtenResolutions"),
    signerName: v.string(),
    memberId: v.optional(v.id("members")),
  },
  returns: v.any(),
  handler: (ctx, args) => signPortable(toPortableMutationCtx(ctx), args),
});

export const markFailed = mutation({
  args: { id: v.id("writtenResolutions"), note: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => markFailedPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("writtenResolutions") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
