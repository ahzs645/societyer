import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  cadenceRuleValidator,
  gapLocatorValidator,
  gapReviewEventValidator,
} from "../validators/gaps";

/**
 * Gap identification (findings A14/A15, audit section 4).
 *
 * - `representationGaps`: *system* gaps — a source detail the app cannot (yet)
 *   represent natively, typed by information type and reason so it can be
 *   counted, triaged, linked to the record it affects, and closed.
 * - `governanceExpectations`: what records *should* exist (AGM each calendar
 *   year, board cadence, annual report after the AGM, ...). Expanded into
 *   expected periods by `continuity:gaps` and matched against native records.
 * - `continuityPeriodMarks`: a user's disposition of one expected period
 *   ("never held", "cancelled", "waived", evidence attached).
 */
export const gapTables = {
  representationGaps: defineTable({
    societyId: v.id("societies"),
    infoType: v.string(), // controlled list in shared/gaps.ts (e.g. "motion.dissent", "agreement")
    reason: v.string(), // no_schema_field | no_import_key | import_dropped | no_ui_input | identity_unresolved | ambiguous_source | not_transposed
    status: v.string(), // open | kept_as_text | resolved_native | schema_change_requested | wont_fix
    origin: v.optional(v.string()), // preflight | extraction | reviewer | backfill | import | manual
    title: v.optional(v.string()),
    sourceDocumentId: v.optional(v.id("documents")),
    sourceExternalId: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    sourceEvidenceId: v.optional(v.id("sourceEvidence")),
    locator: v.optional(gapLocatorValidator),
    excerpt: v.optional(v.string()),
    observedDate: v.optional(v.string()), // YYYY, YYYY-MM or YYYY-MM-DD
    bodyKey: v.optional(v.string()), // members | board | committee:<id> | free text
    affectedTable: v.optional(v.string()),
    affectedId: v.optional(v.string()),
    proposedTargetTable: v.optional(v.string()),
    proposedField: v.optional(v.string()),
    proposedValue: v.optional(v.any()),
    importSessionId: v.optional(v.id("documents")),
    importRecordId: v.optional(v.id("documents")),
    resolvedTable: v.optional(v.string()),
    resolvedId: v.optional(v.string()),
    resolutionNote: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    sensitivity: v.optional(v.string()), // standard | restricted
    reviewHistory: v.array(gapReviewEventValidator),
    createdAtISO: v.string(),
    updatedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_info_type", ["societyId", "infoType"])
    .index("by_society_dedupe", ["societyId", "dedupeKey"])
    .index("by_affected", ["societyId", "affectedTable", "affectedId"])
    .index("by_source_evidence", ["sourceEvidenceId"])
    .index("by_import_session", ["importSessionId"]),

  governanceExpectations: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    kind: v.string(), // meeting | agm | annual_filing | financial_statement | director_consent | director_count | role_term | insurance_term | policy_review | funder_report
    bodyKind: v.string(), // members | board | committee | organization
    committeeId: v.optional(v.id("committees")),
    meetingType: v.optional(v.string()),
    rule: cadenceRuleValidator,
    effectiveFrom: v.optional(v.string()),
    effectiveTo: v.optional(v.string()),
    severity: v.string(), // statutory | bylaw | practice
    origin: v.string(), // rule_pack | bylaw_rules | manual | inferred | schedule_document
    ruleKey: v.optional(v.string()),
    citation: v.optional(v.string()),
    sourceIds: v.optional(v.array(v.string())),
    authorityDocumentId: v.optional(v.id("documents")),
    authorityLocator: v.optional(v.string()),
    status: v.string(), // active | suggested | archived
    confidence: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_rule_key", ["societyId", "ruleKey"])
    .index("by_committee", ["committeeId"]),

  continuityPeriodMarks: defineTable({
    societyId: v.id("societies"),
    expectationKey: v.string(), // governanceExpectations _id or a rule-pack ruleKey
    periodKey: v.string(), // 2018 | 2018-11 | 2018-Q4
    status: v.string(), // never_held | cancelled | waived | not_applicable | satisfied
    reason: v.optional(v.string()),
    evidenceDocumentIds: v.optional(v.array(v.id("documents"))),
    meetingId: v.optional(v.id("meetings")),
    markedByUserId: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_expectation_period", ["societyId", "expectationKey", "periodKey"]),
};
