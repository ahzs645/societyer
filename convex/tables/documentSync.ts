import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Document version + paperless sync tables.
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const documentSyncTables = {
  documentVersions: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    version: v.number(),
    storageProvider: v.string(), // rustfs | demo | local | local-filesystem | convex legacy
    storageKey: v.string(),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    sha256: v.optional(v.string()),
    uploadedByUserId: v.optional(v.id("users")),
    uploadedByName: v.optional(v.string()),
    uploadedAtISO: v.string(),
    changeNote: v.optional(v.string()),
    isCurrent: v.boolean(),
  })
    .index("by_document", ["documentId"])
    .index("by_society", ["societyId"]),

  paperlessConnections: defineTable({
    societyId: v.id("societies"),
    status: v.string(), // connected | disconnected | error
    baseUrl: v.optional(v.string()),
    apiVersion: v.optional(v.string()),
    serverVersion: v.optional(v.string()),
    autoCreateTags: v.boolean(),
    autoUpload: v.boolean(),
    tagPrefix: v.optional(v.string()),
    connectedAtISO: v.string(),
    lastCheckedAtISO: v.optional(v.string()),
    lastSyncAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  paperlessDocumentSyncs: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    connectionId: v.optional(v.id("paperlessConnections")),
    status: v.string(), // queued | processing | complete | failed
    paperlessTaskId: v.optional(v.string()),
    paperlessDocumentId: v.optional(v.number()),
    paperlessDocumentUrl: v.optional(v.string()),
    title: v.string(),
    fileName: v.optional(v.string()),
    tags: v.array(v.string()),
    queuedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    lastCheckedAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["documentId"])
    .index("by_task", ["paperlessTaskId"]),
};
