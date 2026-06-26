import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Document tables (documents, meeting materials, document comments, publications), extracted from convex/schema.ts. Spread back into defineSchema; byte-identical.
 */
export const documentTables = {
  documents: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    meetingId: v.optional(v.id("meetings")),
    agendaItemId: v.optional(v.id("agendaItems")),
    title: v.string(),
    category: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    fileSizeBytes: v.optional(v.number()),
    retentionYears: v.optional(v.number()),
    createdAtISO: v.string(),
    lastOpenedAtISO: v.optional(v.string()),
    lastOpenedByUserId: v.optional(v.id("users")),
    reviewStatus: v.optional(v.string()), // none | in_review | needs_signature | approved | blocked
    librarySection: v.optional(v.string()), // governance | policy | meeting_material | finance | other
    flaggedForDeletion: v.boolean(),
    archivedAtISO: v.optional(v.string()),
    archivedReason: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    importSessionId: v.optional(v.id("documents")),
    importRecordKind: v.optional(v.string()),
    tags: v.array(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_category", ["societyId", "category"])
    .index("by_import_session", ["importSessionId"])
    .index("by_committee", ["committeeId"])
    .index("by_meeting", ["meetingId"])
    .index("by_library_section", ["societyId", "librarySection"])
    .index("by_last_opened", ["societyId", "lastOpenedAtISO"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["societyId"] }),

  meetingMaterials: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    documentId: v.id("documents"),
    agendaItemId: v.optional(v.id("agendaItems")),
    agendaLabel: v.optional(v.string()),
    label: v.optional(v.string()),
    order: v.number(),
    requiredForMeeting: v.boolean(),
    accessLevel: v.string(), // board | committee | members | public | restricted
    accessGrants: v.optional(
      v.array(
        v.object({
          subjectType: v.string(), // attendee | member | director | user | committee | group
          subjectId: v.optional(v.string()),
          subjectLabel: v.string(),
          access: v.string(), // view | comment | sign | manage
          note: v.optional(v.string()),
        }),
      ),
    ),
    availabilityStatus: v.optional(v.string()), // available | pending | expired | withdrawn
    syncStatus: v.optional(v.string()), // online | synced | offline | unavailable
    expiresAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_document", ["documentId"])
    .index("by_agenda_item", ["agendaItemId"]),

  documentComments: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    pageNumber: v.optional(v.number()),
    anchorText: v.optional(v.string()),
    authorName: v.string(),
    authorUserId: v.optional(v.id("users")),
    body: v.string(),
    status: v.string(), // open | resolved
    createdAtISO: v.string(),
    resolvedAtISO: v.optional(v.string()),
    resolvedByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["documentId"])
    .index("by_document_status", ["documentId", "status"]),

  publications: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    summary: v.optional(v.string()),
    category: v.string(), // AnnualReport | Bylaws | AGM | Policy | Notice | Resource | Custom
    documentId: v.optional(v.id("documents")),
    url: v.optional(v.string()),
    publishedAtISO: v.optional(v.string()),
    status: v.string(), // Draft | Published | Archived
    reviewStatus: v.optional(v.string()), // Draft | InReview | Approved
    approvedByUserId: v.optional(v.id("users")),
    approvedAtISO: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    createdAtISO: v.string(),
  }).index("by_society", ["societyId"]),
};
