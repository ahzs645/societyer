import { defineTable } from "convex/server";
import { v } from "convex/values";

export const meetingSourceTables = {
  meetingSources: defineTable({
    societyId: v.id("societies"), meetingId: v.id("meetings"), actorId: v.id("users"),
    fileName: v.string(), size: v.number(), kind: v.string(), fingerprint: v.string(),
    status: v.string(), offset: v.number(), createdAt: v.number(),
    remoteName: v.string(), uploadUrl: v.optional(v.string()), expiresAt: v.optional(v.number()),
    itemId: v.optional(v.string()), eTag: v.optional(v.string()), versionId: v.optional(v.string()),
    lease: v.optional(v.string()), leaseUntil: v.optional(v.number()),
    pendingHash: v.optional(v.string()), pendingSize: v.optional(v.number()),
    hashes: v.array(v.string()), verifiedOffset: v.number(),
    transcriptImported: v.optional(v.boolean()),
    textChunks: v.optional(v.number()), textBytes: v.optional(v.number()), textComplete: v.optional(v.boolean()),
    jobId: v.optional(v.string()), jobStatus: v.optional(v.string()), jobStartedAt: v.optional(v.number()), jobError: v.optional(v.string()),
  }).index("by_meeting", ["meetingId"]).index("by_actor_fingerprint", ["actorId", "meetingId", "fingerprint"]),
  // Recordings kept in workspace file storage (hosted native storage, or the
  // desktop app's disk). SharePoint recordings stay in meetingSources.
  meetingRecordings: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    fileName: v.string(),
    size: v.number(),
    mimeType: v.optional(v.string()),
    // "convex" (a `_storage` id) or "local-filesystem" (a desktop file key).
    provider: v.union(v.literal("convex"), v.literal("local-filesystem")),
    storageKey: v.string(),
    sha256: v.optional(v.string()),
    uploadedByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
  }).index("by_meeting", ["meetingId"]).index("by_society", ["societyId"]),
  // A person's own notes on a meeting (shared/functions/meetingPersonalNotes.ts):
  // private until shared. userId is a string: local workspaces have an owner
  // with no users row.
  meetingPersonalNotes: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    userId: v.string(),
    authorName: v.string(),
    body: v.string(),
    shared: v.boolean(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_meeting", ["meetingId"]).index("by_meeting_user", ["meetingId", "userId"]),
  // Who a named transcript speaker is in this workspace, remembered from the
  // last assignment (shared/functions/transcripts.ts): "Ahmad Jalil" in a
  // Teams VTT is the same person next time. `unbound` remembers "no one".
  speakerBindings: defineTable({
    societyId: v.id("societies"),
    labelKey: v.string(),
    label: v.string(),
    personId: v.optional(v.string()),
    name: v.optional(v.string()),
    unbound: v.optional(v.boolean()),
    updatedAtISO: v.string(),
  }).index("by_society_label", ["societyId", "labelKey"]),
  meetingSourceText: defineTable({ sourceId: v.id("meetingSources"), index: v.number(), text: v.string() })
    .index("by_source_index", ["sourceId", "index"]),
};
