import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const VISIBLE_DOCUMENT_CATEGORIES = [
  "Constitution",
  "Bylaws",
  "Minutes",
  "FinancialStatement",
  "Policy",
  "Filing",
  "Other",
  "Insurance",
  "Grant",
  "Receipt",
  "CourtOrder",
  "WorkflowGenerated",
];

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const groups = await Promise.all(
      VISIBLE_DOCUMENT_CATEGORIES.map((category) =>
        ctx.db
          .query("documents")
          .withIndex("by_society_category", (q) => q.eq("societyId", societyId).eq("category", category))
          .collect(),
      ),
    );
    return groups.flat().sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  },
});

export const getMany = query({
  args: { ids: v.array(v.id("documents")) },
  handler: async (ctx, { ids }) => {
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return rows.filter(Boolean);
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    title: v.string(),
    category: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    retentionYears: v.optional(v.number()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("documents", {
      ...args,
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
    }),
});

export const createGovernanceDocumentFromLocalFile = mutation({
  args: {
    societyId: v.id("societies"),
    documentKind: v.union(
      v.literal("constitution"),
      v.literal("bylaws"),
      v.literal("constitutionAndBylaws"),
      v.literal("privacyPolicy"),
    ),
    title: v.string(),
    category: v.optional(v.string()),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    storageKey: v.string(),
    sha256: v.optional(v.string()),
    tags: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
    changeNote: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    replaceExisting: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const society = await ctx.db.get(args.societyId);
    if (!society) throw new Error("Society not found.");

    const nowISO = new Date().toISOString();
    const uploader = args.actingUserId ? await ctx.db.get(args.actingUserId) : null;
    const category =
      args.category ??
      (args.documentKind === "privacyPolicy"
        ? "Policy"
        : args.documentKind === "constitution"
          ? "Constitution"
          : "Bylaws");
    const tags = Array.from(new Set(args.tags));

    const documentId = await ctx.db.insert("documents", {
      societyId: args.societyId,
      title: args.title,
      category,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      url: args.sourceUrl,
      createdAtISO: nowISO,
      flaggedForDeletion: false,
      tags,
    });

    const versionId = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId,
      version: 1,
      storageProvider: "local",
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      sha256: args.sha256,
      uploadedByUserId: args.actingUserId,
      uploadedByName: uploader?.displayName ?? "BC Registry connector",
      uploadedAtISO: nowISO,
      changeNote: args.changeNote ?? "Imported from BC Registry filing history.",
      isCurrent: true,
    });

    const patch: any = { updatedAt: Date.now() };
    if (
      (args.documentKind === "constitution" || args.documentKind === "constitutionAndBylaws") &&
      (args.replaceExisting || !society.constitutionDocId)
    ) {
      patch.constitutionDocId = documentId;
    }
    if (
      (args.documentKind === "bylaws" || args.documentKind === "constitutionAndBylaws") &&
      (args.replaceExisting || !society.bylawsDocId)
    ) {
      patch.bylawsDocId = documentId;
    }
    if (
      args.documentKind === "privacyPolicy" &&
      (args.replaceExisting || !society.privacyPolicyDocId)
    ) {
      patch.privacyPolicyDocId = documentId;
    }
    if (Object.keys(patch).length > 1) {
      await ctx.db.patch(args.societyId, patch);
    }

    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: uploader?.displayName ?? "BC Registry connector",
      entityType: "document",
      entityId: documentId,
      action: "document-imported",
      summary: `Imported ${args.title} from BC Registry.`,
      createdAtISO: nowISO,
    });

    return {
      documentId,
      versionId,
      linked: {
        constitution: patch.constitutionDocId === documentId,
        bylaws: patch.bylawsDocId === documentId,
        privacyPolicy: patch.privacyPolicyDocId === documentId,
      },
    };
  },
});

export const createLocalDocumentFromConnector = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    category: v.string(),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    storageKey: v.string(),
    sha256: v.optional(v.string()),
    tags: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    changeNote: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    skipDuplicateCheck: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sourceIds = args.sourceExternalIds ?? [];
    if (!args.skipDuplicateCheck) {
      const existing = await ctx.db
        .query("documents")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
        .collect();
      const duplicate = existing.find((document) => {
        if (document.fileName && document.fileName === args.fileName) return true;
        const existingSourceIds = document.sourceExternalIds ?? [];
        return sourceIds.some((sourceId) => existingSourceIds.includes(sourceId));
      });
      if (duplicate) {
        return { documentId: duplicate._id, versionId: null, reused: true };
      }
    }

    const nowISO = new Date().toISOString();
    const uploader = args.actingUserId ? await ctx.db.get(args.actingUserId) : null;
    const tags = Array.from(new Set(args.tags));
    const documentId = await ctx.db.insert("documents", {
      societyId: args.societyId,
      title: args.title,
      category: args.category,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      url: args.sourceUrl,
      sourceExternalIds: sourceIds.length ? sourceIds : undefined,
      sourcePayloadJson: args.sourcePayloadJson,
      createdAtISO: nowISO,
      flaggedForDeletion: false,
      tags,
    });

    const versionId = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId,
      version: 1,
      storageProvider: "local",
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      sha256: args.sha256,
      uploadedByUserId: args.actingUserId,
      uploadedByName: uploader?.displayName ?? "Browser connector",
      uploadedAtISO: nowISO,
      changeNote: args.changeNote ?? "Imported from browser connector export.",
      isCurrent: true,
    });

    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: uploader?.displayName ?? "Browser connector",
      entityType: "document",
      entityId: documentId,
      action: "document-imported",
      summary: `Imported ${args.title} from browser connector export.`,
      createdAtISO: nowISO,
    });

    return { documentId, versionId, reused: false };
  },
});

export const mergeConnectorDocumentMetadata = mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    sha256: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    sourceUrl: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    changeNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found.");
    const existingTags = document.tags ?? [];
    const existingSourceIds = document.sourceExternalIds ?? [];
    await ctx.db.patch(args.documentId, {
      title: args.title ?? document.title,
      category: args.category ?? document.category,
      fileName: args.fileName ?? document.fileName,
      mimeType: args.mimeType ?? document.mimeType,
      fileSizeBytes: args.fileSizeBytes ?? document.fileSizeBytes,
      url: args.sourceUrl ?? document.url,
      sourceExternalIds: args.sourceExternalIds?.length
        ? Array.from(new Set([...existingSourceIds, ...args.sourceExternalIds]))
        : document.sourceExternalIds,
      sourcePayloadJson: args.sourcePayloadJson ?? document.sourcePayloadJson,
      tags: args.tags?.length ? Array.from(new Set([...existingTags, ...args.tags])) : existingTags,
    });

    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const currentVersion = versions.find((version) => version.isCurrent) ?? versions[0];
    if (currentVersion) {
      await ctx.db.patch(currentVersion._id, {
        fileName: args.fileName ?? currentVersion.fileName,
        mimeType: args.mimeType ?? currentVersion.mimeType,
        fileSizeBytes: args.fileSizeBytes ?? currentVersion.fileSizeBytes,
        sha256: args.sha256 ?? currentVersion.sha256,
        changeNote: args.changeNote ?? currentVersion.changeNote,
      });
    }

    return { documentId: args.documentId, versionId: currentVersion?._id ?? null, reused: true };
  },
});

export const flagForDeletion = mutation({
  args: { id: v.id("documents"), flagged: v.boolean() },
  handler: async (ctx, { id, flagged }) => {
    await ctx.db.patch(id, { flaggedForDeletion: flagged });
  },
});

export const archive = mutation({
  args: { id: v.id("documents"), reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    await ctx.db.patch(id, {
      archivedAtISO: new Date().toISOString(),
      archivedReason: reason,
      flaggedForDeletion: false,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
