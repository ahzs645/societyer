// @ts-nocheck
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { assertNativeFileStorageEnabled } from "./providers/env";
import { getUrlPortable } from "../shared/functions/files";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";
import {
  claimStorageId,
  requireAuthenticated,
  requireOwnedRow,
  requireSocietyMembership,
} from "../shared/functions/access";

async function requireUploadMembership(ctx: MutationCtx) {
  const portableCtx = await toPortableMutationCtx(ctx);
  const principal = requireAuthenticated(portableCtx);
  const directUserId = principal.kind === "user" ? principal.userId : principal.actorUserId;
  if (principal.societyId) {
    await requireSocietyMembership(portableCtx, principal.societyId);
    return;
  }
  if (directUserId) {
    const user = await portableCtx.db.get(directUserId, "users");
    if (typeof user?.societyId === "string") {
      await requireSocietyMembership(portableCtx, user.societyId);
      return;
    }
  }
  if (principal.kind === "user") {
    const memberships = await portableCtx.db
      .query("users")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", principal.subject))
      .collect();
    const active = memberships.find((membership) =>
      typeof membership.societyId === "string" &&
      (!membership.status || membership.status === "Active"));
    if (active && typeof active.societyId === "string") {
      await requireSocietyMembership(portableCtx, active.societyId);
      return;
    }
  }
  throw new Error("Society membership not found.");
}

export const generateUploadUrl = mutation({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    assertNativeFileStorageEnabled();
    await requireUploadMembership(ctx);
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
  handler: async (ctx) => {
    await requireUploadMembership(ctx);
    return ctx.storage.generateUploadUrl();
  },
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
    const portableCtx = await toPortableMutationCtx(ctx);
    const document = await requireOwnedRow(portableCtx, "documents", documentId);
    await claimStorageId(portableCtx, storageId, String(document.societyId));
    await ctx.db.patch(documentId, { storageId, fileName, mimeType, fileSizeBytes });
  },
});

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.any(),
  handler: async (ctx, args) => getUrlPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});
