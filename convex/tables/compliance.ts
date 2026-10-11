import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Optional societies-row fields holding reviewed annual-deadline evidence
 * (shared/corporationSettings.ts, shared/annualGovernanceEvidence.ts). Each
 * calendar review is scoped to one profile, obligation, cycle and nominal
 * boundary; each completion is an actual held meeting or a reviewed written
 * annual-business instrument with its evidence.
 */
export const annualDeadlineEvidenceValidators = {
  annualDeadlineCalendarReviews: v.optional(v.array(v.object({
    profileId: v.string(),
    obligation: v.union(v.literal("annual_meeting"), v.literal("annual_return")),
    cycleYear: v.number(),
    nominalDueDate: v.string(),
    reviewedDueDate: v.string(),
    reviewedOn: v.string(),
    verified: v.boolean(),
    evidenceRef: v.string(),
    calendarBasis: v.string(),
    channel: v.optional(v.string()),
    recordedAtISO: v.optional(v.string()),
    recordedByUserId: v.optional(v.string()),
  }))),
  annualMeetingCompletions: v.optional(v.array(v.object({
    date: v.string(),
    kind: v.union(v.literal("held"), v.literal("written_annual_business"), v.literal("written_waiver")),
    cycleYear: v.optional(v.number()),
    annualReferenceDate: v.optional(v.string()),
    verified: v.optional(v.boolean()),
    evidenceRef: v.optional(v.string()),
    writtenResolutionId: v.optional(v.id("writtenResolutions")),
    financialYearEnd: v.optional(v.string()),
    recordedAtISO: v.optional(v.string()),
    recordedByUserId: v.optional(v.string()),
  }))),
  /** CBCA: the actual financial year-end the next annual meeting must deal with. */
  annualMeetingFinancialYearEnd: v.optional(v.string()),
  /** Ontario: the actual taxation-year end selected for the annual-return assessment. */
  annualReturnPeriodEnd: v.optional(v.string()),
};

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
    // Inclusive bound on a recurring deadline: once the next occurrence would
    // fall after this date, completing stops spawning further occurrences.
    recurrenceEndDate: v.optional(v.string()),
    linkedFilingId: v.optional(v.id("filings")),
    // Agreements register: the agreement this obligation comes from and a
    // stable key per obligation (deliverable / report / renewal / term end).
    agreementId: v.optional(v.id("agreements")),
    sourceKey: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_agreement", ["agreementId"])
    .index("by_society_due", ["societyId", "dueDate"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_done", ["societyId", "done"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["societyId"] }),

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
