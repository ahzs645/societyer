/**
 * Gate: representation gaps (system gaps). Covers the controlled vocabulary,
 * legacy sourceEvidence classification and backfill, preflight gap emission,
 * the `representationGaps` import bundle key, and triage.
 * Synthetic fixtures only.
 */
import assert from "node:assert/strict";
import {
  bodyKeyFromText,
  classifyLegacySourceEvidence,
  extractObservedDate,
  infoTypeForBundlePath,
  INFO_TYPES,
  isLegacyUnsupportedEvidence,
  normalizeInfoType,
  observedDateForSource,
} from "../shared/gapCatalog";
import { importBundlePreflightGaps, importBundlePreflightIssues } from "../shared/importBundlePreflight";
import { recordsFromBundle } from "../shared/functions/importSessionHelpers/importSessionRecordKinds";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { actionPermission } from "../shared/functions/actionPolicy";

/* ------------------------------ vocabulary ------------------------------- */

assert.equal(new Set(INFO_TYPES.map((type) => type.key)).size, INFO_TYPES.length, "info types are unique");
assert.equal(normalizeInfoType(" Motion.Dissent "), "motion.dissent");
assert.equal(normalizeInfoType("not a key!"), "other");

/* --------------------------- date extraction ----------------------------- */

assert.equal(extractObservedDate("Operations Executive Meeting Minutes July 2014 _.docx"), "2014-07");
assert.equal(extractObservedDate("Example_OpsAgenda_Oct2017.docx"), "2017-10");
assert.equal(extractObservedDate("Board minutes 2012-01-31 approved.pdf"), "2012-01-31");
assert.equal(extractObservedDate("April_18_2023 DRAFT AGM Minutes"), "2023-04-18");
assert.equal(extractObservedDate("Minutes of 28 November 2018"), "2018-11-28");
assert.equal(extractObservedDate("Sept. 21, 2021 Board"), "2021-09-21");
assert.equal(extractObservedDate("2018 Financial Statement.xlsx"), "2018");
assert.equal(extractObservedDate("no date here"), undefined);
assert.equal(observedDateForSource("Ops minutes July 2014.docx", "July 2014 – Meeting\nDate:\t\tJuly 2, 2014\nSubject: Minutes"), "2014-07-02");
assert.equal(observedDateForSource("Ops minutes 2015.docx", "Date: July 2, 2014"), "2015", "title year wins when the Date line disagrees");

const committees = [{ _id: "c-ops", name: "Operations Committee" }, { _id: "c-aq", name: "AQMP" }];
assert.equal(bodyKeyFromText("2016 AGM Script.doc", committees), "members");
assert.equal(bodyKeyFromText("Example Operations Committee Agenda Oct 2017", committees), "committee:c-ops");
assert.equal(bodyKeyFromText("AQMP notes 2024-02", committees), "committee:c-aq");
assert.equal(bodyKeyFromText("BOD minutes Feb 2012", committees), "board");
assert.equal(bodyKeyFromText("Newsletter", committees), undefined);

/* -------------------------- legacy classification ------------------------ */

const legacy = (sourceTitle: string, targetTable: string, extra: Record<string, unknown> = {}) => ({
  _id: `se_${sourceTitle}`, societyId: "soc", sourceTitle, targetTable, evidenceKind: "import_support", sensitivity: "standard", status: "NeedsReview", ...extra,
});
assert.equal(isLegacyUnsupportedEvidence(legacy("x", "minutes")), true);
assert.equal(isLegacyUnsupportedEvidence(legacy("x", "minutes", { targetId: "minutes_1" })), false, "linked evidence is provenance, not a gap");
assert.equal(isLegacyUnsupportedEvidence({ ...legacy("x", "documents"), evidenceKind: "restricted" }), false);
const cases: [string, string, string, string][] = [
  ["2021_Example-FBC Service Agreement_SIGNED.pdf", "documents", "agreement", "no_schema_field"],
  ["Re Consent to Act as a Director.msg", "peopleDirectory", "correspondence", "no_schema_field"],
  ["Consent to Act as a Director - Example.pdf", "peopleDirectory", "director.consent", "no_import_key"],
  ["Ops Committee - Terms of Reference (2022).docx", "committees", "committee.mandate", "no_import_key"],
  ["Example_OpsAgenda_Oct2017.docx", "minutes", "meeting.package", "not_transposed"],
  ["Operations Executive Meeting Minutes July 2014 _.docx", "minutes", "meeting.minutes", "not_transposed"],
  ["04. April 2021 (cancelled)", "minutes", "meeting.cancelled", "not_transposed"],
  ["Board Meeting Schedule 2017.doc", "minutes", "meeting.schedule", "no_schema_field"],
  ["2024_Society_Annual Report Receipt.pdf", "documents", "filing.annual_report", "not_transposed"],
  ["Balance Sheet Dec 31, 2024 (Revised).xls", "financialStatementImports", "financial.statement", "not_transposed"],
  ["WSEP 2021 Budget Tracking.xlsx", "commitments", "budget", "not_transposed"],
  ["Wood smoke exchange program", "commitments", "program.project", "no_schema_field"],
  ["D&O policy renewal letter", "insurancePolicies", "insurance.policy", "not_transposed"],
  ["Newsletter spring", "communicationCampaigns", "communication.campaign", "not_transposed"],
  ["Delegation of Signing Authority Policy 2022", "documents", "signing_authority.tiers", "no_schema_field"],
  ["Code of Conduct", "documents", "policy.version", "not_transposed"],
];
for (const [title, table, infoType, reason] of cases) {
  const draft = classifyLegacySourceEvidence(legacy(title, table), committees);
  assert.equal(draft.infoType, infoType, `${title} → ${infoType}`);
  assert.equal(draft.reason, reason, `${title} reason`);
}
const opsDraft = classifyLegacySourceEvidence(legacy("Example_OpsAgenda_Oct2017.docx", "minutes", { excerpt: "Operations Committee Meeting\nDate:\t\tOctober 10, 2017 (noon)" }), committees);
assert.equal(opsDraft.observedDate, "2017-10-10");
assert.equal(opsDraft.bodyKey, "committee:c-ops");

/* --------------------------- preflight emission -------------------------- */

const bundle = {
  sources: [{ externalSystem: "gdrive", externalId: "gdrive:1", title: "Minutes" }],
  members: [{ firstName: "Example", organizationName: "Example Org" }],
  meetingMinutes: [{ sourceExternalIds: ["gdrive:1"], motions: [{ motionText: "Motion", dissentReport: "Two directors dissent" }] }],
};
const issues = importBundlePreflightIssues(bundle);
const preflightGaps = importBundlePreflightGaps(bundle);
assert.equal(preflightGaps.length, issues.length, "each loss becomes one gap");
const memberGap = preflightGaps.find((gap) => gap.location === "members")!;
assert.deepEqual([memberGap.infoType, memberGap.reason], ["member.organization", "no_import_key"]);
const dissentGap = preflightGaps.find((gap) => gap.location.endsWith("dissentReport"))!;
assert.deepEqual([dissentGap.infoType, dissentGap.reason, dissentGap.proposedField, dissentGap.proposedValue, dissentGap.sourceExternalId], ["motion.dissent", "import_dropped", "dissentReport", "Two directors dissent", "gdrive:1"]);
assert.equal(importBundlePreflightGaps({ sources: {} }).length, 0, "structural errors are not gaps");
assert.deepEqual(infoTypeForBundlePath("meetingMinutes[0].detailedAttendance[2].affiliationNote").infoType, "attendance.person_link");

/* ---------------------------- bundle import key -------------------------- */

assert.deepEqual(importBundlePreflightIssues({ representationGaps: [{ infoType: "motion.dissent", reason: "no_schema_field", excerpt: "Dissent recorded", sourceExternalIds: ["gdrive:2"] }] }), []);
const records = recordsFromBundle({ representationGaps: [{ infoType: "agreement", reason: "no_schema_field", title: "Service agreement" }] });
assert.equal(records.length, 1);
assert.deepEqual([records[0].recordKind, records[0].targetModule], ["representationGap", "representationGaps"]);

/* ------------------------ portable handlers + triage ---------------------- */

assert.equal(actionPermission("representationGaps:list", "query"), "documents:read");
assert.equal(actionPermission("representationGaps:bulkSetStatus", "mutation"), "documents:write");
assert.equal(actionPermission("representationGaps:importSection", "mutation"), "documents:write");

const db = new MemoryDb({
  seed: {
    societies: [{ _id: "soc", name: "Synthetic Society" }, { _id: "other", name: "Other Society" }],
    users: [
      { _id: "owner", societyId: "soc", role: "Owner", status: "Active", displayName: "Owner Person" },
      { _id: "viewer", societyId: "soc", role: "Viewer", status: "Active" },
    ],
    committees: [{ _id: "c-ops", societyId: "soc", name: "Operations Committee", cadence: "Monthly", color: "blue", status: "Active", createdAtISO: "2020-01-01" }],
    meetings: [{ _id: "mt1", societyId: "soc", type: "Board", title: "Board", scheduledAt: "2021-03-02T19:00:00Z", status: "Held", electronic: false, attendeeIds: [] }],
    minutes: [{ _id: "mn1", societyId: "soc", meetingId: "mt1", heldAt: "2021-03-02", sourceDocumentIds: ["doc-src"], attendees: [], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [] }],
    sourceEvidence: [
      legacy("Example_OpsAgenda_Oct2017.docx", "minutes", { _id: "se1", sourceDocumentId: "doc-src", externalSystem: "google-drive", externalId: "google-drive:1", summary: "s", createdAtISO: "2026-01-01", accessLevel: "internal", excerpt: "Operations Committee Meeting\nDate: October 10, 2017" }),
      legacy("2021 Service Agreement.pdf", "documents", { _id: "se2", externalSystem: "google-drive", externalId: "google-drive:2", summary: "s", createdAtISO: "2026-01-01", accessLevel: "internal" }),
      legacy("Confidential roster", "peopleDirectory", { _id: "se3", externalSystem: "google-drive", externalId: "google-drive:3", summary: "s", createdAtISO: "2026-01-01", accessLevel: "restricted", sensitivity: "restricted", excerpt: "Private phone numbers" }),
      { ...legacy("Linked", "minutes"), _id: "se4", targetId: "mt1", externalSystem: "x", summary: "s", createdAtISO: "2026-01-01", accessLevel: "internal" },
    ],
  },
});
const principal = (userId: string) => () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: userId, userId, societyId: "soc" });
const owner = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("owner") }).registerAll(PORTABLE_FUNCTIONS);
const viewer = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("viewer") }).registerAll(PORTABLE_FUNCTIONS);

// Backfill: batched, idempotent, restricted excerpts never copied.
const first: any = await owner.runMutation("representationGaps:backfillFromSourceEvidence", { societyId: "soc", limit: 2 });
assert.deepEqual([first.created, first.remaining], [2, 1]);
const second: any = await owner.runMutation("representationGaps:backfillFromSourceEvidence", { societyId: "soc", limit: 2 });
assert.deepEqual([second.created, second.remaining], [1, 0]);
const third: any = await owner.runMutation("representationGaps:backfillFromSourceEvidence", { societyId: "soc" });
assert.equal(third.created, 0, "idempotent");
const gaps = db.dump("representationGaps") as any[];
assert.equal(gaps.length, 3);
const opsGap = gaps.find((gap) => gap.sourceEvidenceId === "se1");
assert.deepEqual([opsGap.infoType, opsGap.reason, opsGap.observedDate, opsGap.bodyKey, opsGap.origin, opsGap.status], ["meeting.package", "not_transposed", "2017-10-10", "committee:c-ops", "backfill", "open"]);
const restricted = gaps.find((gap) => gap.sourceEvidenceId === "se3");
assert.deepEqual([opsGap.affectedTable, opsGap.affectedId], ["meetings", "mt1"], "a source that fed a meeting's minutes links the gap to that meeting");
assert.equal(gaps.find((gap) => gap.sourceEvidenceId === "se2").affectedId, undefined);
assert.equal(restricted.excerpt, undefined);
assert.equal(restricted.sensitivity, "restricted");
assert.equal(db.dump("sourceEvidence").length, 4, "evidence rows are left untouched");

const summary: any = await owner.runQuery("representationGaps:summary", { societyId: "soc" });
assert.equal(summary.total, 3);
assert.deepEqual(summary.legacyEvidence, { total: 3, converted: 3 });
assert.equal(summary.byStatus.open, 3);
assert.ok(summary.groups.some((group: any) => group.infoType === "agreement" && group.reason === "no_schema_field"));

// Reviewer "can't represent" entry linked to a meeting, plus the badge count.
await assert.rejects(() => viewer.runMutation("representationGaps:create", { societyId: "soc", infoType: "motion.dissent", reason: "no_schema_field" }), /Permission documents:write/);
await assert.rejects(() => owner.runMutation("representationGaps:create", { societyId: "soc", infoType: "motion.dissent", reason: "because" }), /Unsupported gap reason/);
const gapId = await owner.runMutation("representationGaps:create", { societyId: "soc", infoType: "motion.dissent", reason: "no_schema_field", excerpt: "Two directors asked that their dissent be recorded.", affectedTable: "meetings", affectedId: "mt1", locator: { page: "2", section: "5. New business" } });
const badge: any = await owner.runQuery("representationGaps:countForRecord", { societyId: "soc", affectedTable: "meetings", affectedId: "mt1" });
assert.deepEqual(badge, { total: 2, open: 2, keptAsText: 0 }, "reviewer gap plus the backfilled source gap");
const created = db.dump("representationGaps").find((row: any) => row._id === gapId) as any;
assert.equal(created.origin, "reviewer");
assert.equal(created.reviewHistory[0].actorUserId, "owner");
assert.deepEqual(created.locator, { page: "2", section: "5. New business" });

// Triage lifecycle with review history.
await owner.runMutation("representationGaps:setStatus", { id: gapId, status: "kept_as_text", note: "Kept in minutes discussion" });
await assert.rejects(() => owner.runMutation("representationGaps:setStatus", { id: gapId, status: "done" }), /Unsupported gap status/);
await owner.runMutation("representationGaps:setStatus", { id: gapId, status: "resolved_native", resolvedTable: "meetings", resolvedId: "mt1" });
const resolved = db.dump("representationGaps").find((row: any) => row._id === gapId) as any;
assert.deepEqual(resolved.reviewHistory.map((event: any) => event.toStatus), ["open", "kept_as_text", "resolved_native"]);
assert.equal(resolved.reviewHistory[2].fromStatus, "kept_as_text");
assert.equal(resolved.resolvedId, "mt1");

const bulk: any = await owner.runMutation("representationGaps:bulkSetStatus", { societyId: "soc", infoType: "agreement", reason: "no_schema_field", status: "schema_change_requested", note: "Agreements object (A5)" });
assert.equal(bulk.updated, 1);
await assert.rejects(() => owner.runMutation("representationGaps:bulkSetStatus", { societyId: "soc", status: "wont_fix" }), /Select gaps/);
await assert.rejects(() => owner.runMutation("representationGaps:bulkSetStatus", { societyId: "soc", infoType: "agreement", status: "resolved_native" }), /one at a time/);
const list: any = await owner.runQuery("representationGaps:list", { societyId: "soc", status: "schema_change_requested" });
assert.equal(list.total, 1);

// Preflight losses are recorded when a session is created from a bundle.
const sessionId = await owner.runMutation("importSessions:createFromBundle", { societyId: "soc", name: "Synthetic bundle", bundle });
const preflightRows = (db.dump("representationGaps") as any[]).filter((row) => row.origin === "preflight");
assert.equal(preflightRows.length, preflightGaps.length);
assert.ok(preflightRows.every((row) => row.importSessionId === sessionId));
await owner.runMutation("representationGaps:recordPreflight", { societyId: "soc", bundle, importSessionId: sessionId });
assert.equal((db.dump("representationGaps") as any[]).filter((row) => row.origin === "preflight").length, preflightGaps.length, "preflight recording is idempotent per session");

await owner.runMutation("representationGaps:remove", { id: gapId });
assert.equal((db.dump("representationGaps") as any[]).some((row) => row._id === gapId), false);

console.log("Representation gap checks passed.");
