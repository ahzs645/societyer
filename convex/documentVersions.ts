import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { canActAs, requireRole } from "./users";
import {
  buildStorageKey,
  createUploadUrl,
  createDownloadUrl,
} from "./providers/storage";
import { assertNativeFileStorageEnabled } from "./providers/env";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import {
  listForDocumentPortable,
  latestPortable,
  getPortable,
  rollbackPortable,
} from "../shared/functions/documentVersions";

export const listForDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => listForDocumentPortable(await toPortableQueryCtx(ctx), args),
});

export const latest = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => latestPortable(await toPortableQueryCtx(ctx), args),
});

// Action: caller asks us for a presigned upload URL. The client PUTs the file
// itself and then calls `recordUploadedVersion` to register the new version.
export const beginUpload = action({
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
    if (!args.actingUserId) {
      throw new Error("Role Director required — no authenticated actor.");
    }
    const actor = await ctx.runQuery(api.users.get, { id: args.actingUserId });
    if (!actor) throw new Error("Unknown user.");
    if (actor.societyId !== args.societyId) throw new Error("User is not part of this society.");
    if (!canActAs(actor.role as any, "Director")) {
      throw new Error(`Role Director required — you have ${actor.role}.`);
    }

    // Look up the latest version number inside the action via a query.
    const latestVersion = await ctx.runQuery(api.documentVersions.latest, {
      documentId: args.documentId,
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;
    const key = buildStorageKey(
      args.societyId,
      args.documentId,
      nextVersion,
      args.fileName,
    );
    const presigned = await createUploadUrl({ key, mimeType: args.mimeType });
    return {
      version: nextVersion,
      presigned,
    };
  },
});

export const recordUploadedVersion = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    version: v.number(),
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
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });

    // Mark old versions non-current.
    const existing = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    for (const row of existing) {
      if (row.isCurrent) await ctx.db.patch(row._id, { isCurrent: false });
    }

    const uploader = args.actingUserId
      ? await ctx.db.get(args.actingUserId)
      : null;

    const id = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId: args.documentId,
      version: args.version,
      storageProvider: args.storageProvider,
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      sha256: args.sha256,
      uploadedByUserId: args.actingUserId,
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
      summary: `Uploaded ${args.fileName} as v${args.version}${args.changeNote ? ` — ${args.changeNote}` : ""}`,
      createdAtISO: new Date().toISOString(),
    });

    // Honor the connection's "auto-upload new versions" toggle: mirror the new
    // version to Paperless-ngx after local storage succeeds. Best-effort and
    // scheduled (the sync is an HTTP action) so it never blocks the upload.
    const connection = (
      await ctx.db
        .query("paperlessConnections")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
        .collect()
    )
      .sort((a, b) => String(b.connectedAtISO).localeCompare(String(a.connectedAtISO)))[0];
    if (connection && connection.autoUpload && connection.status === "connected") {
      await ctx.scheduler.runAfter(0, api.paperless.syncDocument, {
        societyId: args.societyId,
        documentId: args.documentId,
        versionId: id,
        actingUserId: args.actingUserId,
      });
    }

    return id;
  },
});

export const getDownloadUrl = action({
  args: { versionId: v.id("documentVersions") },
  returns: v.any(),
  handler: async (ctx, { versionId }): Promise<string | null> => {
    const version = await ctx.runQuery(api.documentVersions.get, { id: versionId });
    if (!version) return null;
    const target = await downloadTargetForVersion(version);
    return target.kind === "url" ? (target as any).url : null;
  },
});

export const getDownloadTarget = action({
  args: { versionId: v.id("documentVersions") },
  returns: v.any(),
  handler: async (ctx, { versionId }) => {
    const version = await ctx.runQuery(api.documentVersions.get, { id: versionId });
    if (!version) return null;
    return await downloadTargetForVersion(version);
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
      url: `${base.replace(/\/$/, "")}/api/v1/workflow-generated-documents/${encodeURIComponent(version.storageKey)}`,
    };
  }

  if (version.storageProvider === "rustfs" || version.storageProvider === "demo") {
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

export const get = query({
  args: { id: v.id("documentVersions") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

// Demo-friendly helper: creates a new version inline with a synthesized blob.
// The frontend calls this when demo mode is on to simulate the upload flow
// without juggling presigned URLs.
export const createDemoVersion = mutation({
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
  handler: async (ctx, args): Promise<Id<"documentVersions">> => {
    assertNativeFileStorageEnabled();
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
    const uploader = args.actingUserId
      ? await ctx.db.get(args.actingUserId)
      : null;
    const id = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId: args.documentId,
      version: nextVersion,
      storageProvider: "demo",
      storageKey: key,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      uploadedByUserId: args.actingUserId,
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
    return id;
  },
});

export const rollback = mutation({
  args: {
    versionId: v.id("documentVersions"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => rollbackPortable(await toPortableMutationCtx(ctx), args),
});
