import { defineTable } from "convex/server";
import { v } from "convex/values";

export const storageTables = {
  documentUploadHandles: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    actorUserId: v.id("users"),
    provider: v.string(),
    stagingKey: v.string(),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.number(),
    expiresAtISO: v.string(),
    status: v.string(), // pending | verifying | verified | consumed
    storageKey: v.optional(v.string()),
    sha256: v.optional(v.string()),
    verifiedAtISO: v.optional(v.string()),
  }).index("by_document", ["documentId"]),
  storageOwnership: defineTable({
    storageId: v.id("_storage"),
    societyId: v.id("societies"),
    createdAtISO: v.string(),
  }).index("by_storage", ["storageId"]),
};
