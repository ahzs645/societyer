import { v } from "convex/values";
const sourceExternalIds = v.optional(v.array(v.string()));
export const historicalActionValidator = v.object({
  entryId: v.string(), actionKey: v.string(), sourceActionId: v.optional(v.string()), text: v.string(), assignee: v.optional(v.string()),
  dateAssigned: v.optional(v.string()), dueDate: v.optional(v.string()),
  status: v.union(v.literal("unknown"), v.literal("open"), v.literal("in_progress"), v.literal("ongoing"), v.literal("on_hold"), v.literal("completed"), v.literal("cancelled")),
  statusAsOf: v.optional(v.string()), sourceStatus: v.optional(v.string()), carriedFromMinutesId: v.optional(v.id("minutes")), carriedFromEntryId: v.optional(v.string()),
  sourceExternalIds, sourceLocator: v.optional(v.string()), evidence: v.optional(v.string()), notes: v.optional(v.string()),
});
export const quorumEventValidator = v.object({
  eventId: v.string(), status: v.union(v.literal("confirmed"), v.literal("not_met"), v.literal("not_recorded")), atTime: v.optional(v.string()),
  scope: v.union(v.literal("meeting"), v.literal("session"), v.literal("item")), scopeLabel: v.optional(v.string()), eligibleCount: v.optional(v.number()), presentCount: v.optional(v.number()),
  reason: v.optional(v.string()), sourceExternalIds, sourceLocator: v.optional(v.string()), evidence: v.optional(v.string()),
});
export const sourceVersionValidator = v.object({
  versionId: v.string(), label: v.string(), status: v.union(v.literal("unknown"), v.literal("draft"), v.literal("revised"), v.literal("adopted")),
  sourceExternalIds: v.array(v.string()), sourceDate: v.optional(v.string()), supersedesVersionId: v.optional(v.string()), adoptedAt: v.optional(v.string()),
  adoptedInMeetingId: v.optional(v.id("meetings")), adoptionMotionId: v.optional(v.id("motions")), adoptionEvidence: v.optional(v.string()), notes: v.optional(v.string()), contentJson: v.optional(v.string()),
});
export const meetingHistoryFields = {
  historicalActions: v.optional(v.array(historicalActionValidator)), quorumEvents: v.optional(v.array(quorumEventValidator)), sourceVersions: v.optional(v.array(sourceVersionValidator)),
};
