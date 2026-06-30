import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { listPortable, createPortable, removePortable, summaryPortable } from "../shared/functions/dividends";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    declaredOn: v.string(),
    shareClass: v.string(),
    perShareCents: v.number(),
    sharesOutstanding: v.number(),
    currency: v.string(),
    // An independently keyed/imported total to cross-check against
    // perShareCents * sharesOutstanding (YCN "Record - Dividends" reconciliation).
    expectedTotalCents: v.optional(v.number()),
    notes: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("dividends") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

export const summary = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => summaryPortable(toPortableQueryCtx(ctx), args),
});
