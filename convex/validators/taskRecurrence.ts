import { v } from "convex/values";

/** A repeating task's rule (shared/taskRecurrence.ts). `anchorDay` is filled in by the server. */
export const taskRecurrenceValidator = v.object({
  frequency: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"), v.literal("yearly")),
  interval: v.number(),
  until: v.optional(v.string()),
  anchorDay: v.optional(v.number()),
});
