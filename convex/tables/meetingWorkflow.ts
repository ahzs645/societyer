import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Board-meeting-workflow + records/evidence tables, extracted from
 * convex/schema.ts (modularization). Spread back into defineSchema({...}); the
 * generated data model and runtime are byte-identical.
 */
export const meetingWorkflowTables = {

  agendas: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    title: v.string(),
    status: v.string(), // Draft | Published | Finalized
    notes: v.optional(v.string()),
    updatedAtISO: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  agendaItems: defineTable({
    societyId: v.id("societies"),
    agendaId: v.id("agendas"),
    order: v.number(),
    type: v.string(), // discussion | motion | report | break | executive_session
    title: v.string(),
    depth: v.optional(v.union(v.literal(0), v.literal(1))),
    details: v.optional(v.string()),
    presenter: v.optional(v.string()),
    timeAllottedMinutes: v.optional(v.number()),
    motionTemplateId: v.optional(v.id("motionTemplates")),
    motionId: v.optional(v.id("motions")),
    motionText: v.optional(v.string()),
    outcome: v.optional(v.string()), // Pending | Carried | Defeated | Tabled | Deferred (see src/lib/motionGovernance)
    resolutionId: v.optional(v.id("writtenResolutions")),
    createdAtISO: v.string(),
  })
    .index("by_agenda", ["agendaId"])
    .index("by_society", ["societyId"]),

  motionTemplates: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    body: v.string(),
    category: v.string(), // governance | finance | membership | operations | bylaws | other
    requiresSpecialResolution: v.boolean(),
    notes: v.optional(v.string()),
    usageCount: v.optional(v.number()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_category", ["societyId", "category"]),

  // Standalone first-class motion. Replaces the embedded minutes.motions[] blob
  // and folds in motionBacklog (one unified lifecycle from capture to vote to
  // archive). Meetings/agendas/minutes reference a motion by id rather than
  // duplicating its data. See docs/motions-first-class-object-design.md.
  motions: defineTable({
    societyId: v.id("societies"),

    // Identity / content
    title: v.optional(v.string()),
    text: v.string(),
    category: v.optional(v.string()), // governance | finance | membership | operations | bylaws | privacy | other

    // Movers — denormalized display name + optional structured refs
    movedBy: v.optional(v.string()),
    movedByMemberId: v.optional(v.id("members")),
    movedByDirectorId: v.optional(v.id("directors")),
    secondedBy: v.optional(v.string()),
    secondedByMemberId: v.optional(v.id("members")),
    secondedByDirectorId: v.optional(v.id("directors")),

    // Classification → references bylawRuleSet.resolutionTypes by id; label is a
    // denormalized snapshot so a superseded rule set doesn't orphan old motions.
    resolutionTypeId: v.optional(v.string()),
    resolutionTypeLabel: v.optional(v.string()),

    // Explicit lifecycle — overridable, never inferred
    status: v.string(), // Backlog | Draft | Agenda | Moved | Tabled | Deferred | Withdrawn | Voted | Archived
    outcome: v.optional(v.string()), // Carried | Defeated (meaningful only when status = Voted)
    statusIsManual: v.optional(v.boolean()),

    // How the motion was decided, orthogonal to its threshold:
    //   vote      — a counted ballot (the tally is judged against the threshold)
    //   consent   — adopted by unanimous/general consent ("no objection"); no tally
    //   automatic — meeting closed without a motion (agenda done / time / emergency)
    // Most procedural motions (adjournment, approve-minutes) are decided by
    // consent, so they carry without a recorded tally. See
    // shared/proceduralMotions.ts.
    decidedBy: v.optional(v.string()),
    // Stored procedural-kind slug (adjournment | previous-minutes | …) so the
    // master list can classify/hide by an explicit label instead of re-matching
    // the wording. Null for ordinary substantive motions.
    proceduralKind: v.optional(v.string()),

    // Votes (model A — current/most-recent tally on the motion itself)
    votesFor: v.optional(v.number()),
    votesAgainst: v.optional(v.number()),
    abstentions: v.optional(v.number()),

    // Backlog columns (folded in from motionBacklog — no separate table)
    backlogPriority: v.optional(v.string()), // high | normal | low
    source: v.optional(v.string()), // pipa-setup | manual | imported | minutes-motion | minutes-section
    seededKey: v.optional(v.string()),
    // Free-form note carried over from the folded-in motionBacklog (threshold,
    // attachment, or setup hint). Display-only.
    notes: v.optional(v.string()),

    // Free-form labels for the master list filter (e.g. "adjournment",
    // "previous-minutes", "finance"). Routine labels are hidden by default.
    tags: v.optional(v.array(v.string())),

    // Placement / provenance (references, not copies)
    primaryMeetingId: v.optional(v.id("meetings")), // where it was last considered
    targetMeetingId: v.optional(v.id("meetings")), // where it's planned to go
    minutesId: v.optional(v.id("minutes")),
    // Transitional positional link to minutes.sections[] mirrored from the
    // embedded motion during dual-write. Superseded by an agenda/section motionId
    // reference once reads are flipped, but kept so section grouping survives.
    sectionIndex: v.optional(v.number()),
    sectionTitle: v.optional(v.string()),
    agendaId: v.optional(v.id("agendas")),
    agendaItemId: v.optional(v.id("agendaItems")),
    motionTemplateId: v.optional(v.id("motionTemplates")),
    sourceMotionEvidenceId: v.optional(v.id("motionEvidence")),
    sourceMinutesId: v.optional(v.id("minutes")),
    sourceMotionIndex: v.optional(v.number()),
    sourceSectionIndex: v.optional(v.number()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),

    // History — append-only consideration / status trail (model A's safety net)
    history: v.optional(
      v.array(
        v.object({
          at: v.string(),
          meetingId: v.optional(v.id("meetings")),
          minutesId: v.optional(v.id("minutes")),
          status: v.string(),
          outcome: v.optional(v.string()),
          votesFor: v.optional(v.number()),
          votesAgainst: v.optional(v.number()),
          abstentions: v.optional(v.number()),
          note: v.optional(v.string()),
        }),
      ),
    ),

    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]) // drives the backlog list
    .index("by_society_seeded", ["societyId", "seededKey"]) // idempotent seeding
    .index("by_minutes", ["minutesId"])
    .index("by_meeting", ["primaryMeetingId"])
    .index("by_target_meeting", ["targetMeetingId"]),

  minuteBookItems: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    recordType: v.string(), // meeting | minutes | resolution | written_resolution | filing | policy | document | package | other
    effectiveDate: v.optional(v.string()),
    status: v.string(), // Draft | Current | NeedsReview | Archived | Superseded
    documentIds: v.array(v.id("documents")),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    filingId: v.optional(v.id("filings")),
    policyId: v.optional(v.id("policies")),
    workflowPackageId: v.optional(v.id("workflowPackages")),
    writtenResolutionId: v.optional(v.id("writtenResolutions")),
    signatureIds: v.array(v.id("signatures")),
    sourceEvidenceIds: v.array(v.id("sourceEvidence")),
    archivedAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "recordType"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_effective", ["societyId", "effectiveDate"]),

  // Where records are kept if not at the registered office
  recordsLocation: defineTable({
    societyId: v.id("societies"),
    address: v.string(),
    noticePostedAtOffice: v.boolean(),
    postedAtISO: v.optional(v.string()),
    computerProvidedForInspection: v.boolean(),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  sourceEvidence: defineTable({
    societyId: v.id("societies"),
    sourceDocumentId: v.optional(v.id("documents")),
    externalSystem: v.string(),
    externalId: v.optional(v.string()),
    sourceTitle: v.string(),
    sourceDate: v.optional(v.string()),
    evidenceKind: v.string(), // provenance | restricted | publication_sidecar | import_support
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    sensitivity: v.string(), // standard | restricted
    accessLevel: v.string(), // public | internal | restricted
    summary: v.string(),
    excerpt: v.optional(v.string()),
    status: v.string(), // NeedsReview | Linked | Verified | Rejected
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_external", ["societyId", "externalId"])
    .index("by_source", ["sourceDocumentId"])
    .index("by_target", ["targetTable", "targetId"]),

  secretVaultItems: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    service: v.string(),
    credentialType: v.string(), // recovery_key | registry_key | api_key | password | certificate | other
    ownerRole: v.optional(v.string()),
    custodianUserId: v.optional(v.id("users")),
    custodianPersonName: v.optional(v.string()),
    custodianEmail: v.optional(v.string()),
    backupCustodianName: v.optional(v.string()),
    backupCustodianEmail: v.optional(v.string()),
    username: v.optional(v.string()),
    accessUrl: v.optional(v.string()),
    storageMode: v.string(), // stored_encrypted | external_reference | encrypted_elsewhere | not_stored
    externalLocation: v.optional(v.string()),
    secretEncrypted: v.optional(v.string()),
    secretPreview: v.optional(v.string()),
    secretUpdatedAtISO: v.optional(v.string()),
    secretUpdatedByUserId: v.optional(v.id("users")),
    secretLastRevealedAtISO: v.optional(v.string()),
    secretLastRevealedByUserId: v.optional(v.id("users")),
    revealPolicy: v.optional(v.string()), // owner_admin | owner_admin_custodian | owner_only
    authorizedUserIds: v.optional(v.array(v.id("users"))),
    lastVerifiedAtISO: v.optional(v.string()),
    rotationDueAtISO: v.optional(v.string()),
    status: v.string(), // Active | NeedsReview | Rotated | Revoked
    sensitivity: v.string(), // restricted | high
    accessLevel: v.string(), // restricted
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_service", ["societyId", "service"])
    .index("by_society_status", ["societyId", "status"]),

  archiveAccessions: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    accessionNumber: v.optional(v.string()),
    containerType: v.string(), // box | binder | drive | folder | external_archive | other
    location: v.string(),
    custodian: v.optional(v.string()),
    dateReceived: v.optional(v.string()),
    dateRange: v.optional(v.string()),
    status: v.string(), // NeedsReview | InCustody | Transferred | Archived
    accessRestrictions: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "dateReceived"]),
};
