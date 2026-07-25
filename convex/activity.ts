import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { listPortable, listForRecordPortable, logPortable } from "../shared/functions/activity";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const listForRecord = query({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => listForRecordPortable(await toPortableQueryCtx(ctx), args),
});

export const log = mutation({
  args: {
    societyId: v.id("societies"),
    actor: v.string(),
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    action: v.string(),
    summary: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => logPortable(await toPortableMutationCtx(ctx), args),
});
