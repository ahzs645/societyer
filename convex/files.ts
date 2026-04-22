// @ts-nocheck
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
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
    await ctx.db.patch(documentId, { storageId, fileName, mimeType, fileSizeBytes });
  },
});

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.any(),
  handler: async (ctx, { storageId }) => ctx.storage.getUrl(storageId),
});
