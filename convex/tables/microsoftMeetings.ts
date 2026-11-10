import { defineTable } from "convex/server";
import { v } from "convex/values";
export const teamsSourceValidator = v.object({ kind: v.union(v.literal("scheduled"), v.literal("adhoc")), resourceId: v.string(), transcriptId: v.string(), organizerId: v.string(), createdAt: v.string(), endAt: v.optional(v.string()), title: v.string(), chatId: v.optional(v.string()), joinUrl: v.optional(v.string()) });
export const teamsParticipantValidator = v.object({ objectId: v.string(), tenantId: v.string(), name: v.string(), userId: v.optional(v.id("users")) });
export const microsoftMeetingTables = {
  microsoftMeetingCandidates: defineTable({ societyId: v.id("societies"), sourceKey: v.string(), source: teamsSourceValidator, expiresAt: v.number() }).index("by_society_sourceKey", ["societyId", "sourceKey"]).index("by_society", ["societyId"]),
  microsoftMeetingImports: defineTable({ societyId: v.id("societies"), sourceKey: v.string(), source: teamsSourceValidator, meetingId: v.id("meetings"), transcriptHash: v.string(), importedBy: v.id("users"), importedAt: v.number(), participants: v.array(teamsParticipantValidator), contextChatId: v.optional(v.string()), contextChatConfirmed: v.boolean() }).index("by_society_sourceKey", ["societyId", "sourceKey"]).index("by_meeting", ["meetingId"]),
  microsoftMeetingPeople: defineTable({ societyId: v.id("societies"), userId: v.id("users"), personId: v.id("peopleDirectory"), reviewedBy: v.id("users"), reviewedAt: v.number() }).index("by_society_userId", ["societyId", "userId"]),
};
