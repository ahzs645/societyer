import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Agreements register (schema finding A5): contracts, funding agreements,
 * leases, MOUs and other agreements with their parties, term, money,
 * deliverables, reporting obligations, documents, version chain and the
 * authorizing motion. Every field except the identity is optional so imports
 * and converted drafts can hold what the source says and nothing more.
 *
 * Enumerations (kind, status, party role, deliverable status, recurrence,
 * renewal decision) are stored as strings and validated by the portable
 * handlers (`shared/agreements.ts`), so backups carrying a value added later
 * still restore. See docs/implementation-notes/agreements-register.md.
 */

const agreementParty = v.object({
  name: v.string(),
  role: v.string(), // us | counterparty | funder | guarantor | other
  organizationName: v.optional(v.string()),
  directoryPersonId: v.optional(v.id("peopleDirectory")),
  contact: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const agreementSignatory = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  directoryPersonId: v.optional(v.id("peopleDirectory")),
  signedAtISO: v.optional(v.string()),
});

export const agreementTables = {
  agreements: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    kind: v.optional(v.string()), // service | funding | lease | consulting | MOU | partnership | employment | licence | data_sharing | other
    status: v.optional(v.string()), // draft | negotiating | active | expired | terminated | superseded | unknown
    agreementNumber: v.optional(v.string()),
    summary: v.optional(v.string()),
    parties: v.optional(v.array(agreementParty)),
    ourSignatories: v.optional(v.array(agreementSignatory)),
    counterpartySignatories: v.optional(v.array(agreementSignatory)),
    signedDate: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    autoRenew: v.optional(v.boolean()),
    renewalTermMonths: v.optional(v.number()),
    renewalNoticeDays: v.optional(v.number()),
    terminationNoticeDays: v.optional(v.number()),
    terminationTerms: v.optional(v.string()),
    valueCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    paymentSchedule: v.optional(v.array(v.object({
      label: v.string(),
      dueDate: v.optional(v.string()),
      amountCents: v.optional(v.number()),
      status: v.optional(v.string()),
    }))),
    deliverables: v.optional(v.array(v.object({
      id: v.string(),
      text: v.string(),
      dueDate: v.optional(v.string()),
      owner: v.optional(v.string()),
      ownerPersonId: v.optional(v.id("peopleDirectory")),
      status: v.optional(v.string()), // not_started | in_progress | submitted | accepted | waived
      completedAtISO: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    reportingObligations: v.optional(v.array(v.object({
      id: v.string(),
      text: v.string(),
      dueDate: v.optional(v.string()),
      recurrence: v.optional(v.string()), // once | monthly | quarterly | semiannual | annual
      recipient: v.optional(v.string()),
      status: v.optional(v.string()),
      submittedAtISO: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    confidential: v.optional(v.boolean()),
    governingLaw: v.optional(v.string()),
    // Documents: the signed copy (and its version), plus related drafts/amendments.
    signedDocumentId: v.optional(v.id("documents")),
    signedDocumentVersionId: v.optional(v.id("documentVersions")),
    documentIds: v.optional(v.array(v.id("documents"))),
    // Version chain: a renewal or a replacement points back at its predecessor.
    renewalOfId: v.optional(v.id("agreements")),
    supersedesId: v.optional(v.id("agreements")),
    supersededById: v.optional(v.id("agreements")),
    // Links.
    linkedGrantId: v.optional(v.id("grants")),
    linkedServiceProviderId: v.optional(v.id("serviceProviders")),
    linkedCommitteeId: v.optional(v.id("committees")),
    // Authorization: the meeting / motion that approved entering into it.
    approvedAtMeetingId: v.optional(v.id("meetings")),
    approvalMotionId: v.optional(v.id("motions")),
    approvalNote: v.optional(v.string()),
    renewalDecision: v.optional(v.object({
      decision: v.string(), // undecided | renew | renegotiate | let_expire | terminate
      decidedAtISO: v.optional(v.string()),
      notes: v.optional(v.string()),
      motionId: v.optional(v.id("motions")),
    })),
    terminatedAtISO: v.optional(v.string()),
    terminationReason: v.optional(v.string()),
    // Provenance.
    sourceExternalIds: v.optional(v.array(v.string())),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    intakeRunId: v.optional(v.id("intakeRuns")),
    intakeExtractionId: v.optional(v.id("intakeExtractions")),
    representationGapIds: v.optional(v.array(v.id("representationGaps"))),
    importedFrom: v.optional(v.string()),
    confidence: v.optional(v.string()),
    reviewStatus: v.optional(v.string()), // NeedsReview | Verified | Rejected
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_end", ["societyId", "endDate"])
    .index("by_grant", ["linkedGrantId"])
    .index("by_renewal_of", ["renewalOfId"])
    .index("by_extraction", ["intakeExtractionId"]),
};
