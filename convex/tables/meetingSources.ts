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
  meetingSourceText: defineTable({ sourceId: v.id("meetingSources"), index: v.number(), text: v.string() })
    .index("by_source_index", ["sourceId", "index"]),
};
