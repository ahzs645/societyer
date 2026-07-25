import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  setStatusPortable,
  toggleDonePortable,
  updatePortable,
  removePortable,
  backfillStatusPortable,
} from "../shared/functions/deadlines";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const statusValidator = v.union(
  v.literal("open"),
  v.literal("complete"),
  v.literal("closed"),
);

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.string(),
    category: v.string(),
    status: v.optional(statusValidator),
    recurrence: v.optional(v.string()),
    recurrenceEndDate: v.optional(v.string()),
    linkedFilingId: v.optional(v.id("filings")),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const setStatus = mutation({
  args: { id: v.id("deadlines"), status: statusValidator },
  returns: v.any(),
  handler: async (ctx, args) => setStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const toggleDone = mutation({
  args: { id: v.id("deadlines"), done: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => toggleDonePortable(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("deadlines"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      dueDate: v.optional(v.string()),
      category: v.optional(v.string()),
      status: v.optional(statusValidator),
      done: v.optional(v.boolean()),
      recurrence: v.optional(v.string()),
      recurrenceEndDate: v.optional(v.string()),
      linkedFilingId: v.optional(v.id("filings")),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("deadlines") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const backfillStatus = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => backfillStatusPortable(await toPortableMutationCtx(ctx), args),
});
