import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  notesListForRecordPortable,
  noteCreatePortable,
  noteUpdatePortable,
  noteRemovePortable,
} from "../shared/functions/notes";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const listForRecord = authorizedQuery("notes:listForRecord", query)({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => notesListForRecordPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("notes:create", mutation)({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    author: v.string(),
    body: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => noteCreatePortable(await toPortableMutationCtx(ctx), args),
});

export const update = authorizedMutation("notes:update", mutation)({
  args: { id: v.id("notes"), body: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => noteUpdatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("notes:remove", mutation)({
  args: { id: v.id("notes") },
  returns: v.any(),
  handler: async (ctx, args) => noteRemovePortable(await toPortableMutationCtx(ctx), args),
});
