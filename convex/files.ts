// @ts-nocheck
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertNativeFileStorageEnabled } from "./providers/env";
import { getUrlPortable } from "../shared/functions/files";
import { toPortableQueryCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    assertNativeFileStorageEnabled();
    return ctx.storage.generateUploadUrl();
  },
});

// Branding uploads (society logo / dark logo / letterhead) are allowed even
// when native file storage is disabled: a logo is app identity, not document
// content, and its only sinks are the society.setLogo/setDarkLogo/setLetterhead
// mutations — never the document store. Document/meeting/item uploads keep
// using the gated generateUploadUrl above.
export const generateLogoUploadUrl = mutation({
  args: {},
  returns: v.any(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const attachUploadedFileToDocument = mutation({
  args: {
    documentId: v.id("documents"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { documentId, storageId, fileName, mimeType, fileSizeBytes }) => {
    assertNativeFileStorageEnabled();
    await ctx.db.patch(documentId, { storageId, fileName, mimeType, fileSizeBytes });
  },
});

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.any(),
  handler: async (ctx, args) => getUrlPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});
