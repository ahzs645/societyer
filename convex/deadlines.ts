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
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const setStatus = mutation({
  args: { id: v.id("deadlines"), status: statusValidator },
  returns: v.any(),
  handler: (ctx, args) => setStatusPortable(toPortableMutationCtx(ctx), args),
});

export const toggleDone = mutation({
  args: { id: v.id("deadlines"), done: v.boolean() },
  returns: v.any(),
  handler: (ctx, args) => toggleDonePortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("deadlines") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

export const backfillStatus = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => backfillStatusPortable(toPortableMutationCtx(ctx), args),
});
