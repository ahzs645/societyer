import { authorizedAction, authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation, action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import {
  buildStorageKey,
  buildUploadStorageKey,
  createUploadUrl,
  createDownloadUrl,
  verifyAndSealUpload,
} from "./providers/storage";
import { providers } from "./providers/env";
import { DOCUMENT_STORAGE_CAPABILITIES } from "../shared/storage/providerCapabilities";
import { requireDocumentAccess } from "../shared/functions/documents";
import { validateUploadMetadata, validateUploadHandle } from "../shared/storage/uploadVerification";
import { assertNativeFileStorageEnabled } from "./providers/env";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import {
  listForDocumentPortable,
  latestPortable,
  getPortable,
  rollbackPortable,
} from "../shared/functions/documentVersions";
import {
  canActAs,
  getOwned,
  requireSocietyMembership,
  type Role,
} from "../shared/functions/access";

export const listForDocument = authorizedQuery("documentVersions:listForDocument", query)({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => listForDocumentPortable(await toPortableQueryCtx(ctx), args),
});

export const latest = authorizedQuery("documentVersions:latest", query)({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => latestPortable(await toPortableQueryCtx(ctx), args),
});

// Action: caller asks us for a presigned upload URL. The client PUTs the file
// itself and then calls `recordUploadedVersion` to register the new version.
export const beginUpload = authorizedAction("documentVersions:beginUpload", action)({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertNativeFileStorageEnabled();
    const allocated = await ctx.runMutation(internal.documentVersions.allocateUploadHandle, args);
    const presigned = await createUploadUrl({ key: allocated.stagingKey, mimeType: args.mimeType });
    return { presigned, uploadHandleId: allocated.uploadHandleId };
  },
});

export const storageCapabilities = authorizedQuery("documentVersions:storageCapabilities", query)({
  args: { societyId: v.id("societies") }, returns: v.any(),
  handler: async (ctx, { societyId }) => {
    await requireSocietyMembership(await toPortableQueryCtx(ctx), societyId);
    return { activeProvider: providers.storage().id, deploymentConfigured: providers.storage().live, connectionVerified: false, providers: DOCUMENT_STORAGE_CAPABILITIES };
  },
});

export const allocateUploadHandle = internalMutation({
  args: {
    societyId: v.id("societies"), documentId: v.id("documents"), fileName: v.string(),
    mimeType: v.optional(v.string()), fileSizeBytes: v.optional(v.number()), actingUserId: v.optional(v.id("users")),
  }, returns: v.any(),
  handler: async (ctx, args) => {
    assertNativeFileStorageEnabled();
    validateUploadMetadata(args);
    const portable = await toPortableMutationCtx(ctx);
    const actor = await requireSocietyMembership(portable, args.societyId);
    if (args.actingUserId && String(args.actingUserId) !== actor._id) throw new Error("Authenticated actor does not match the current principal.");
    if (!canActAs(actor.role as Role, "Director")) throw new Error("Role Director required.");
    const document = await requireDocumentAccess(portable, args.documentId, "manage");
    if (String(document.societyId) !== String(args.societyId)) throw new Error("documents not found.");
    const storage = providers.storage();
    const provider = storage.id;
    if (!storage.live || provider === "demo") throw new Error("Live upload storage is not configured. Use the explicit demo upload flow.");
    const stagingKey = buildUploadStorageKey(args.societyId, args.documentId, crypto.randomUUID(), args.fileName);
    const uploadHandleId = await ctx.db.insert("documentUploadHandles", {
      societyId: args.societyId, documentId: args.documentId, actorUserId: actor._id as Id<"users">,
      provider, stagingKey, fileName: args.fileName, mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes!, expiresAtISO: new Date(Date.now() + 15 * 60 * 1000).toISOString(), status: "pending",
    });
    return { uploadHandleId, stagingKey };
  },
});

export const claimUploadHandle = internalMutation({
  args: { uploadHandleId: v.id("documentUploadHandles") }, returns: v.any(),
  handler: async (ctx, { uploadHandleId }) => {
    assertNativeFileStorageEnabled();
    const handle = await ctx.db.get(uploadHandleId);
    if (!handle) throw new Error("Upload handle not found.");
    const portable = await toPortableMutationCtx(ctx);
    const actor = await requireSocietyMembership(portable, handle.societyId);
    if (!canActAs(actor.role as Role, "Director")) throw new Error("Role Director required.");
    await requireDocumentAccess(portable, handle.documentId, "manage");
    validateUploadHandle(handle, { societyId: handle.societyId, documentId: handle.documentId, actorUserId: actor._id }, "pending");
    const storageKey = buildUploadStorageKey(handle.societyId, handle.documentId, `sealed-${crypto.randomUUID()}`, handle.fileName);
    await ctx.db.patch(uploadHandleId, { status: "verifying", storageKey });
    return { ...handle, storageKey };
  },
});

export const markUploadVerified = internalMutation({
  args: { uploadHandleId: v.id("documentUploadHandles"), sha256: v.string() }, returns: v.null(),
  handler: async (ctx, { uploadHandleId, sha256 }) => {
    const handle = await ctx.db.get(uploadHandleId);
    if (!handle) throw new Error("Upload handle not found.");
    const actor = await requireSocietyMembership(await toPortableMutationCtx(ctx), handle.societyId);
    validateUploadHandle(handle, { societyId: handle.societyId, documentId: handle.documentId, actorUserId: actor._id }, "verifying");
    await ctx.db.patch(uploadHandleId, { status: "verified", sha256, verifiedAtISO: new Date().toISOString() });
    return null;
  },
});

export const completeUpload = authorizedAction("documentVersions:completeUpload", action)({
  args: { uploadHandleId: v.id("documentUploadHandles") }, returns: v.any(),
  handler: async (ctx, { uploadHandleId }) => {
    const handle = await ctx.runMutation(internal.documentVersions.claimUploadHandle, { uploadHandleId });
    const verified = await verifyAndSealUpload(handle);
    await ctx.runMutation(internal.documentVersions.markUploadVerified, { uploadHandleId, sha256: verified.sha256 });
    return { uploadHandleId };
  },
});

export const recordUploadedVersion = authorizedMutation("documentVersions:recordUploadedVersion", mutation)({
  args: {
    uploadHandleId: v.optional(v.id("documentUploadHandles")),
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    storageProvider: v.string(),
    storageKey: v.string(),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    sha256: v.optional(v.string()),
    changeNote: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertNativeFileStorageEnabled();
    const portableCtx = await toPortableMutationCtx(ctx);
    const uploader = await requireSocietyMembership(portableCtx, args.societyId);
    if (args.actingUserId && String(args.actingUserId) !== uploader._id) {
      throw new Error("Authenticated actor does not match the current principal.");
    }
    if (!canActAs(uploader.role as Role, "Director")) {
      throw new Error(`Role Director required — you have ${uploader.role}.`);
    }
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    await getOwned(portableCtx, "documents", args.documentId, args.societyId);
    await requireDocumentAccess(portableCtx, args.documentId, "manage");
    if (!args.uploadHandleId) throw new Error("A server-verified upload handle is required.");
    const handle = await ctx.db.get(args.uploadHandleId);
    validateUploadHandle(handle, { societyId: args.societyId, documentId: args.documentId, actorUserId: uploader._id }, "verified");
    if (!handle?.storageKey || !handle.sha256) throw new Error("Upload verification is incomplete.");
    // Provider, object identity and checksum come only from the verified handle.
    args = { ...args, storageProvider: handle.provider, storageKey: handle.storageKey, fileName: handle.fileName, mimeType: handle.mimeType, fileSizeBytes: handle.fileSizeBytes, sha256: handle.sha256 };
    await ctx.db.patch(handle._id, { status: "consumed" });
    const uploaderId = uploader._id;

    // Allocate the authoritative version in this mutation. Concurrent recorders
    // conflict on this read and Convex retries one against the committed row.
    const existing = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const nextVersion = Math.max(0, ...existing.map((row) => row.version)) + 1;
    const storageKeyOwner = await ctx.db
      .query("documentVersions")
      .withIndex("by_storage_key", (q) => q.eq("storageKey", args.storageKey))
      .first();
    if (storageKeyOwner) {
      throw new Error("This uploaded file has already been recorded as a document version.");
    }

    // Mark old versions non-current.
    for (const row of existing) {
      if (row.isCurrent) await ctx.db.patch(row._id, { isCurrent: false });
    }

    const id = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId: args.documentId,
      version: nextVersion,
      storageProvider: args.storageProvider,
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      sha256: args.sha256,
      uploadedByUserId: uploaderId as Id<"users">,
      uploadedByName: uploader?.displayName,
      uploadedAtISO: new Date().toISOString(),
      changeNote: args.changeNote,
      isCurrent: true,
    });

    // Mirror the key bits onto the parent document so existing UI works.
    await ctx.db.patch(args.documentId, {
      storageId: undefined,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
    });

    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: uploader?.displayName ?? "System",
      entityType: "document",
      subjectId: args.documentId,
      // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
      entityId: args.documentId,
      action: "version-uploaded",
      summary: `Uploaded ${args.fileName} as v${nextVersion}${args.changeNote ? ` — ${args.changeNote}` : ""}`,
      createdAtISO: new Date().toISOString(),
    });

    // Provider sync is currently an explicit, authorized user action. A scheduled
    // public action would lose the user's JWT and cannot safely impersonate them.
    // Keep legacy autoUpload settings readable until an actor-aware worker exists.

    return { versionId: id, version: nextVersion };
  },
});

export const getDownloadUrl = authorizedAction("documentVersions:getDownloadUrl", action)({
  args: { versionId: v.id("documentVersions") },
  returns: v.any(),
  handler: async (ctx, { versionId }): Promise<string | null> => {
    const version = await ctx.runQuery(api.documentVersions.get, { id: versionId });
    if (!version) return null;
    const target = await downloadTargetForVersion(version);
    return target.kind === "url" ? (target as any).url : null;
  },
});

export const getDownloadTarget = authorizedAction("documentVersions:getDownloadTarget", action)({
  args: { versionId: v.id("documentVersions") },
  returns: v.any(),
  handler: async (ctx, { versionId }) => {
    const version = await ctx.runQuery(api.documentVersions.get, { id: versionId });
    if (!version) return null;
    const target = await downloadTargetForVersion(version);
    if (version.storageProvider === "local" && target.kind === "url") {
      // Browser downloads use the app's same-origin API proxy, allowing a
      // bearer header without exposing it to a configured external host.
      // getDownloadUrl retains the absolute URL for server-side consumers.
      const url = new URL((target as any).url);
      return { ...target, url: `${url.pathname}${url.search}` };
    }
    return target;
  },
});

async function downloadTargetForVersion(version: any) {
  const baseTarget = {
    provider: version.storageProvider,
    key: version.storageKey,
    fileName: version.fileName,
    mimeType: version.mimeType,
    fileSizeBytes: version.fileSizeBytes,
  };

  if (version.storageProvider === "local-filesystem") {
    return { kind: "local-filesystem", ...baseTarget };
  }

  if (version.storageProvider === "generated-inline") {
    return { kind: "url", ...baseTarget, url: version.storageKey };
  }

  if (version.storageProvider === "local") {
    const base =
      process.env.SOCIETYER_API_PUBLIC_URL ??
      process.env.BETTER_AUTH_BASE_URL?.replace(/\/$/, "").replace(/:5173$/, ":8787") ??
      "http://127.0.0.1:8787";
    return {
      kind: "url",
      ...baseTarget,
      url: `${base.replace(/\/$/, "")}/api/v1/workflow-generated-documents/${encodeURIComponent(version.storageKey)}?societyId=${encodeURIComponent(version.societyId)}`,
    };
  }

  if (version.storageProvider === "rustfs" || version.storageProvider === "r2" || version.storageProvider === "demo") {
    return {
      kind: "url",
      ...baseTarget,
      url: await createDownloadUrl({
        provider: version.storageProvider,
        key: version.storageKey,
      }),
    };
  }

  return {
    kind: "unavailable",
    ...baseTarget,
    reason: `Document version provider "${version.storageProvider}" does not expose a downloadable URL.`,
  };
}

export const get = authorizedQuery("documentVersions:get", query)({
  args: { id: v.id("documentVersions") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

// Demo-friendly helper: creates a new version inline with a synthesized blob.
// The frontend calls this when demo mode is on to simulate the upload flow
// without juggling presigned URLs.
export const createDemoVersion = authorizedMutation("documentVersions:createDemoVersion", mutation)({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    changeNote: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertNativeFileStorageEnabled();
    const portableCtx = await toPortableMutationCtx(ctx);
    const uploader = await requireSocietyMembership(portableCtx, args.societyId);
    if (args.actingUserId && String(args.actingUserId) !== uploader._id) {
      throw new Error("Authenticated actor does not match the current principal.");
    }
    if (!canActAs(uploader.role as Role, "Director")) {
      throw new Error(`Role Director required — you have ${uploader.role}.`);
    }
    await getOwned(portableCtx, "documents", args.documentId, args.societyId);
    await requireDocumentAccess(portableCtx, args.documentId, "manage");
    if (providers.storage().live) throw new Error("Demo versions are unavailable on a live storage deployment.");
    const uploaderId = uploader._id;
    const existing = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const nextVersion = Math.max(0, ...existing.map((r) => r.version)) + 1;
    const key = buildStorageKey(
      args.societyId,
      args.documentId,
      nextVersion,
      args.fileName,
    );
    for (const row of existing) {
      if (row.isCurrent) await ctx.db.patch(row._id, { isCurrent: false });
    }
    const id = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId: args.documentId,
      version: nextVersion,
      storageProvider: "demo",
      storageKey: key,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      uploadedByUserId: uploaderId as Id<"users">,
      uploadedByName: uploader?.displayName ?? "Demo user",
      uploadedAtISO: new Date().toISOString(),
      changeNote: args.changeNote,
      isCurrent: true,
    });
    await ctx.db.patch(args.documentId, {
      storageId: undefined,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: uploader?.displayName ?? "Demo user",
      entityType: "document",
      subjectId: args.documentId,
      // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
      entityId: args.documentId,
      action: "version-uploaded",
      summary: `Uploaded ${args.fileName} as v${nextVersion}${args.changeNote ? ` — ${args.changeNote}` : ""}`,
      createdAtISO: new Date().toISOString(),
    });
    return { versionId: id, version: nextVersion };
  },
});

export const rollback = authorizedMutation("documentVersions:rollback", mutation)({
  args: {
    versionId: v.id("documentVersions"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => rollbackPortable(await toPortableMutationCtx(ctx), args),
});
