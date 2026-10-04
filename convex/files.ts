// @ts-nocheck
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertNativeFileStorageEnabled } from "./providers/env";
import { requireDocumentAccess } from "../shared/functions/documents";
import { getUrlPortable, generateUploadUrlPortable, generateLogoUploadUrlPortable } from "../shared/functions/files";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";
import {
  claimStorageId,
  requireOwnedRow,
  requireRolePortable,
} from "../shared/functions/access";

export const generateUploadUrl = authorizedMutation("files:generateUploadUrl", mutation)({
  args: {
    societyId: v.id("societies"),
    purpose: v.optional(v.union(v.literal("document"), v.literal("meeting"), v.literal("asset"), v.literal("inventory"))),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    assertNativeFileStorageEnabled();
    return generateUploadUrlPortable(await toPortableMutationCtx(ctx, buildConvexCapabilities(ctx)), args);
  },
});

// Branding uploads (society logo / dark logo / letterhead) are allowed even
// when native file storage is disabled: a logo is app identity, not document
// content, and its only sinks are the society.setLogo/setDarkLogo/setLetterhead
// mutations — never the document store. Document/meeting/item uploads keep
// using the gated generateUploadUrl above.
export const generateLogoUploadUrl = authorizedMutation("files:generateLogoUploadUrl", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.string(),
  handler: async (ctx, args) => generateLogoUploadUrlPortable(await toPortableMutationCtx(ctx, buildConvexCapabilities(ctx)), args),
});

export const attachUploadedFileToDocument = authorizedMutation("files:attachUploadedFileToDocument", mutation)({
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
    const portableCtx = await toPortableMutationCtx(ctx);
    const document = await requireOwnedRow(portableCtx, "documents", documentId);
    await requireRolePortable(portableCtx, { societyId: String(document.societyId), required: "Director" });
    await requireDocumentAccess(portableCtx, documentId, "manage");
    const metadata = await ctx.db.system.get(storageId);
    if (!metadata) throw new Error("Uploaded file not found.");
    fileSizeBytes = metadata.size;
    mimeType = metadata.contentType;
    await claimStorageId(portableCtx, storageId, String(document.societyId));
    await ctx.db.patch(documentId, { storageId, fileName, mimeType, fileSizeBytes });
  },
});

export const getUrl = authorizedQuery("files:getUrl", query)({
  args: { storageId: v.id("_storage") },
  returns: v.any(),
  handler: async (ctx, args) => getUrlPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});
