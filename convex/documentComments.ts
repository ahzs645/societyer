import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listForDocumentPortable,
  createPortable,
  setStatusPortable,
  removePortable,
} from "../shared/functions/documentComments";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const listForDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => listForDocumentPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    pageNumber: v.optional(v.number()),
    anchorText: v.optional(v.string()),
    authorName: v.string(),
    authorUserId: v.optional(v.id("users")),
    body: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const setStatus = mutation({
  args: {
    id: v.id("documentComments"),
    status: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => setStatusPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("documentComments") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
