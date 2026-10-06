import { v } from "convex/values";
const sourceExternalIds = v.optional(v.array(v.string()));
export const actionObservationValidator = v.object({
  entryId: v.string(), actionKey: v.string(), sourceActionId: v.optional(v.string()), text: v.string(), assignee: v.optional(v.string()),
  dateAssigned: v.optional(v.string()), dueDate: v.optional(v.string()),
  status: v.union(v.literal("unknown"), v.literal("open"), v.literal("in_progress"), v.literal("ongoing"), v.literal("on_hold"), v.literal("completed"), v.literal("cancelled")),
  statusAsOf: v.optional(v.string()), sourceStatus: v.optional(v.string()), carriedFromMinutesId: v.optional(v.id("minutes")), carriedFromEntryId: v.optional(v.string()),
  sourceExternalIds, sourceLocator: v.optional(v.string()), evidence: v.optional(v.string()), notes: v.optional(v.string()),
});
export const importedSourceVersionValidator = v.object({
  versionId: v.string(), label: v.string(), status: v.union(v.literal("unknown"), v.literal("draft"), v.literal("revised"), v.literal("adopted")),
  sourceExternalIds: v.array(v.string()), sourceDate: v.optional(v.string()), supersedesVersionId: v.optional(v.string()), adoptedAt: v.optional(v.string()),
  adoptedInMeetingId: v.optional(v.id("meetings")), adoptionMotionId: v.optional(v.id("motions")), adoptionEvidence: v.optional(v.string()), notes: v.optional(v.string()), contentJson: v.optional(v.string()),
});
export const meetingHistoryFields = {
  actionObservations: v.optional(v.array(actionObservationValidator)), importedSourceVersions: v.optional(v.array(importedSourceVersionValidator)),
};
