import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { listPortable, createPortable, updatePortable, removePortable } from "../shared/functions/courtOrders";
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
    orderDate: v.string(),
    court: v.string(),
    fileNumber: v.optional(v.string()),
    description: v.string(),
    documentId: v.optional(v.id("documents")),
    status: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("courtOrders"),
    patch: v.object({
      title: v.optional(v.string()),
      orderDate: v.optional(v.string()),
      court: v.optional(v.string()),
      fileNumber: v.optional(v.string()),
      description: v.optional(v.string()),
      documentId: v.optional(v.id("documents")),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("courtOrders") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
