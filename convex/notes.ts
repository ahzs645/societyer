import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  notesListForRecordPortable,
  noteCreatePortable,
  noteUpdatePortable,
  noteRemovePortable,
} from "../shared/functions/notes";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const listForRecord = query({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => notesListForRecordPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
    author: v.string(),
    body: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => noteCreatePortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: { id: v.id("notes"), body: v.string() },
  returns: v.any(),
  handler: (ctx, args) => noteUpdatePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("notes") },
  returns: v.any(),
  handler: (ctx, args) => noteRemovePortable(toPortableMutationCtx(ctx), args),
});
