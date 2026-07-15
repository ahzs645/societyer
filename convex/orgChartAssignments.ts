import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import {
  listPortable,
  listAsOfPortable,
  upsertPortable,
  removePortable,
} from "../shared/functions/orgChartAssignments";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

/**
 * Org chart as it stood on `asOf` (YYYY-MM-DD), reconstructed from the
 * append-only revision history: for each subject, the revision that was open at
 * end-of-day on that date. History begins at the first edit after the revisions
 * table existed, so dates before that return nothing for the affected subjects.
 */
export const listAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => listAsOfPortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    subjectType: v.string(),
    subjectId: v.string(),
    subjectName: v.string(),
    managerType: v.optional(v.string()),
    managerId: v.optional(v.string()),
    managerName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: {
    societyId: v.id("societies"),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
