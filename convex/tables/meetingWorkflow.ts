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
    motionBacklogId: v.optional(v.id("motionBacklog")),
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

  motionBacklog: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    motionText: v.string(),
    category: v.string(), // privacy | governance | finance | membership | operations | bylaws | other
    status: v.string(), // Backlog | Agenda | MinutesDraft | Adopted | Deferred | Archived
    priority: v.optional(v.string()), // high | normal | low
    source: v.optional(v.string()), // pipa-setup | manual | imported
    seededKey: v.optional(v.string()),
    notes: v.optional(v.string()),
    targetMeetingId: v.optional(v.id("meetings")),
    agendaId: v.optional(v.id("agendas")),
    agendaItemId: v.optional(v.id("agendaItems")),
    minutesId: v.optional(v.id("minutes")),
    sourceMinutesId: v.optional(v.id("minutes")),
    sourceMotionIndex: v.optional(v.number()),
    sourceSectionIndex: v.optional(v.number()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_seeded", ["societyId", "seededKey"])
    .index("by_agenda", ["agendaId"])
    .index("by_meeting", ["targetMeetingId"]),

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
