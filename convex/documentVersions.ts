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

export const listForDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { documentId }) => {
    const rows = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
    return rows.sort((a, b) => b.version - a.version);
  },
});

export const latest = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { documentId }) => {
    const rows = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
    return rows.sort((a, b) => b.version - a.version)[0] ?? null;
  },
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
      entityId: args.documentId,
      action: "version-uploaded",
      summary: `Uploaded ${args.fileName} as v${args.version}${args.changeNote ? ` — ${args.changeNote}` : ""}`,
      createdAtISO: new Date().toISOString(),
    });

    return id;
  },
});

export const getDownloadUrl = action({
  args: { versionId: v.id("documentVersions") },
  returns: v.any(),
  handler: async (ctx, { versionId }): Promise<string | null> => {
    const version = await ctx.runQuery(api.documentVersions.get, { id: versionId });
    if (!version) return null;
    if (version.storageProvider === "local") {
      const base =
        process.env.SOCIETYER_API_PUBLIC_URL ??
        process.env.BETTER_AUTH_BASE_URL?.replace(/\/$/, "").replace(/:5173$/, ":8787") ??
        "http://127.0.0.1:8787";
      return `${base.replace(/\/$/, "")}/api/v1/workflow-generated-documents/${encodeURIComponent(version.storageKey)}`;
    }
    return await createDownloadUrl({
      provider: version.storageProvider as "demo" | "rustfs",
      key: version.storageKey,
    });
  },
});

export const get = query({
  args: { id: v.id("documentVersions") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
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
  handler: async (ctx, { versionId, actingUserId }) => {
    const v = await ctx.db.get(versionId);
    if (!v) throw new Error("Version not found.");
    await requireRole(ctx, {
      actingUserId,
      societyId: v.societyId,
      required: "Admin",
    });
    const siblings = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", v.documentId))
      .collect();
    for (const row of siblings) {
      if (row.isCurrent) await ctx.db.patch(row._id, { isCurrent: false });
    }
    await ctx.db.patch(versionId, { isCurrent: true });
    await ctx.db.patch(v.documentId, {
      storageId: undefined,
      fileName: v.fileName,
      mimeType: v.mimeType,
      fileSizeBytes: v.fileSizeBytes,
    });
    await ctx.db.insert("activity", {
      societyId: v.societyId,
      actor: "System",
      entityType: "document",
      entityId: v.documentId,
      action: "rolled-back",
      summary: `Rolled back to v${v.version} (${v.fileName})`,
      createdAtISO: new Date().toISOString(),
    });
  },
});
