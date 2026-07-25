import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  removeSourcePortable,
  bulkSetItemReviewStatusPortable,
  removeItemPortable,
  saveSourcePortable,
  saveItemPortable,
  extractBudgetSourceDetailsPortable,
  bulkImportPortable,
} from "../shared/functions/organizationHistory";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const saveSource = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("documents")),
    payload: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveSourcePortable(await toPortableMutationCtx(ctx), args),
});

export const removeSource = mutation({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => removeSourcePortable(await toPortableMutationCtx(ctx), args),
});

export const saveItem = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("documents")),
    kind: v.string(),
    payload: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveItemPortable(await toPortableMutationCtx(ctx), args),
});

export const bulkSetItemReviewStatus = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("documents"),
        kind: v.string(),
        status: v.string(),
        confidence: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => bulkSetItemReviewStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const extractBudgetSourceDetails = mutation({
  args: {
    societyId: v.id("societies"),
    budgetId: v.id("documents"),
  },
  returns: v.any(),
  handler: async (ctx, args) => extractBudgetSourceDetailsPortable(await toPortableMutationCtx(ctx), args),
});

export const removeItem = mutation({
  args: { id: v.id("documents"), kind: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => removeItemPortable(await toPortableMutationCtx(ctx), args),
});

export const bulkImport = mutation({
  args: {
    societyId: v.id("societies"),
    sources: v.array(v.any()),
    facts: v.array(v.any()),
    events: v.array(v.any()),
    boardTerms: v.optional(v.array(v.any())),
    motions: v.optional(v.array(v.any())),
    budgets: v.optional(v.array(v.any())),
  },
  returns: v.any(),
  handler: async (ctx, args) => bulkImportPortable(await toPortableMutationCtx(ctx), args),
});
