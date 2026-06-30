import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { listPortable, listForRecordPortable, logPortable } from "../shared/functions/activity";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const listForRecord = query({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: (ctx, args) => listForRecordPortable(toPortableQueryCtx(ctx), args),
});

export const log = mutation({
  args: {
    societyId: v.id("societies"),
    actor: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    action: v.string(),
    summary: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => logPortable(toPortableMutationCtx(ctx), args),
});
