import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Transcripts + custom-field tables.
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const transcriptTables = {
  transcripts: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    provider: v.string(), // whisper | demo
    storageKey: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    language: v.optional(v.string()),
    text: v.string(),
    segments: v.array(
      v.object({
        speaker: v.string(),
        text: v.string(),
        startSec: v.number(),
        endSec: v.number(),
      }),
    ),
    createdAtISO: v.string(),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  transcriptionJobs: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    status: v.string(), // queued | running | complete | failed
    provider: v.string(),
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    error: v.optional(v.string()),
    transcriptId: v.optional(v.id("transcripts")),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  // Per-category custom field definitions. Admins add a definition under
  // members/directors/volunteers/employees, then each person in that
  // category can have a value stored in customFieldValues.
  customFieldDefinitions: defineTable({
    societyId: v.id("societies"),
    entityType: v.string(), // members | directors | volunteers | employees
    key: v.string(), // machine key, e.g. "unbc_affiliate_role"
    label: v.string(),
    kind: v.string(), // text | number | date | boolean | email | phone
    required: v.boolean(),
    order: v.number(),
    description: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_entity", ["societyId", "entityType"])
    .index("by_society_entity_key", ["societyId", "entityType", "key"]),

  customFieldValues: defineTable({
    societyId: v.id("societies"),
    definitionId: v.id("customFieldDefinitions"),
    entityType: v.string(),
    entityId: v.string(),
    value: v.any(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_definition", ["definitionId"])
    .index("by_entity_def", ["entityType", "entityId", "definitionId"]),

  // People & governance tables (members, directors, board role assignments/changes, signing authorities, committees, committee members, org-chart assignments), extracted from convex/schema — extracted to convex/tables/people.ts
};
