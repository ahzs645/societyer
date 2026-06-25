import { defineTable } from "convex/server";
import { v } from "convex/values";

export const complianceTables = {
  deadlines: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.string(),
    category: v.string(),
    status: v.optional(
      v.union(v.literal("open"), v.literal("complete"), v.literal("closed")),
    ),
    done: v.optional(v.boolean()),
    recurrence: v.optional(v.string()),
    linkedFilingId: v.optional(v.id("filings")),
  })
    .index("by_society", ["societyId"])
    .index("by_society_due", ["societyId", "dueDate"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_done", ["societyId", "done"]),

  commitments: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    category: v.string(), // Contract | Grant | Facility | Governance | Privacy | Funding | Other
    sourceDocumentId: v.optional(v.id("documents")),
    sourceLabel: v.optional(v.string()),
    sourceExcerpt: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    requirement: v.string(),
    cadence: v.string(), // Once | Monthly | Quarterly | Annual | Every 2 years | Custom
    nextDueDate: v.optional(v.string()),
    dueDateBasis: v.optional(v.string()),
    noticeLeadDays: v.optional(v.number()),
    owner: v.optional(v.string()),
    status: v.string(), // Active | Watching | Paused | Closed
    reviewStatus: v.optional(v.string()), // NeedsReview | Verified | Rejected
    confidence: v.optional(v.number()),
    uncertaintyNote: v.optional(v.string()),
    lastCompletedAtISO: v.optional(v.string()),
    lastCompletionSummary: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_due", ["societyId", "nextDueDate"])
    .index("by_source_document", ["sourceDocumentId"]),

  commitmentEvents: defineTable({
    societyId: v.id("societies"),
    commitmentId: v.id("commitments"),
    title: v.string(),
    happenedAtISO: v.string(),
    meetingId: v.optional(v.id("meetings")),
    evidenceDocumentIds: v.array(v.id("documents")),
    evidenceStatus: v.optional(v.string()), // NeedsReview | Verified | Rejected
    evidenceNotes: v.optional(v.string()),
    summary: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_happened", ["societyId", "happenedAtISO"])
    .index("by_commitment", ["commitmentId"])
    .index("by_meeting", ["meetingId"]),
};
