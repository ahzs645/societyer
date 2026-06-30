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
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const saveSource = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("documents")),
    payload: v.any(),
  },
  returns: v.any(),
  handler: (ctx, args) => saveSourcePortable(toPortableMutationCtx(ctx), args),
});

export const removeSource = mutation({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => removeSourcePortable(toPortableMutationCtx(ctx), args),
});

export const saveItem = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("documents")),
    kind: v.string(),
    payload: v.any(),
  },
  returns: v.any(),
  handler: (ctx, args) => saveItemPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => bulkSetItemReviewStatusPortable(toPortableMutationCtx(ctx), args),
});

export const extractBudgetSourceDetails = mutation({
  args: {
    societyId: v.id("societies"),
    budgetId: v.id("documents"),
  },
  returns: v.any(),
  handler: (ctx, args) => extractBudgetSourceDetailsPortable(toPortableMutationCtx(ctx), args),
});

export const removeItem = mutation({
  args: { id: v.id("documents"), kind: v.string() },
  returns: v.any(),
  handler: (ctx, args) => removeItemPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => bulkImportPortable(toPortableMutationCtx(ctx), args),
});
