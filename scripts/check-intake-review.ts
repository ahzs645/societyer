/** Gate for the intake review and promotion step (WP-J; design §4.4, stage 10–11):
 * field listing and labels, bulk-accept eligibility (stated + verified span +
 * no conflict + confidence ≥ τ), batched reviews with undo, "can't represent"
 * gaps, merge candidates, promotion through the import-session apply path with
 * one fieldProvenance row per promoted field, merging into an existing
 * meeting, server-side reconciliation, and role enforcement. Synthetic data only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { actionPermission } from "../shared/functions/actionPolicy";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { buildImportBundle, coverageReport } from "../shared/intake/bundle";
import { extractBytes } from "../shared/intake/extract";
import { sha256Hex } from "../shared/intake/node/extractFile";
import { runIntakePipeline } from "../shared/intake/pipeline";
import { stageRunInWorkspace } from "../shared/intake/stageRun";
import {
  applyReviews, bulkAcceptCandidates, entityGroups, groupQueue, isBulkEligible, latestDecisions, nameOccurrences, nativeTargetForPath, promotionReadiness,
  reviewFieldsForRecord, riskTier, samplePreview, thresholdFor, validateEditedValue, type ReviewRow,
} from "../shared/intake/review";
import { buildPromotionBundle, defaultInfoTypeForPath, sourceDocumentPayload } from "../shared/intake/promotion";
import { landedValue } from "../shared/functions/intakeReview";
import { writeSyntheticFixtures } from "./lib/intake-synthetic-fixtures";

// ------------------------------------------------------------ policy
for (const name of ["intake:mergeCandidates", "intake:provenanceForExtraction", "intake:runSummaries", "intake:entityCandidates", "intake:bulkAcceptPreview", "intake:getFileExtract", "intake:provenanceForRecords"]) assert.equal(actionPermission(name, "query"), "settings:read");
for (const name of ["intake:reviewFields", "intake:undoReviews", "intake:promoteExtraction", "intake:reconcileRun", "intake:linkNameAcrossRun", "intake:bulkAccept"]) assert.equal(actionPermission(name, "mutation"), "settings:write");

// ------------------------------------------------------------ pipeline + staging
const society = "society_review";
const db = new MemoryDb({ seed: {
  societies: [{ _id: society, name: "Lakeside Clean Air Society" }, { _id: "society_other", name: "Other" }],
  users: [
    { _id: "user_owner", societyId: society, role: "Owner", status: "Active", displayName: "Owner" },
    { _id: "user_director", societyId: society, role: "Director", status: "Active" },
    { _id: "user_member", societyId: society, role: "Member", status: "Active" },
  ],
  meetings: [
    { _id: "meeting_board_no_minutes", societyId: society, title: "Board meeting", scheduledAt: "2025-05-13T12:00:00.000Z", type: "Board", status: "HeldMinutesMissing", attendeeIds: [] },
    { _id: "meeting_exec", societyId: society, title: "Executive meeting (draft record)", scheduledAt: "2025-02-11T12:00:00.000Z", type: "Committee", status: "Held", attendeeIds: [], minutesId: "minutes_exec" },
  ],
  peopleDirectory: [{ _id: "pd_avery", societyId: society, fullName: "Avery Quill", firstName: "Avery", lastName: "Quill", searchName: "avery quill" }],
  minutes: [{ _id: "minutes_exec", societyId: society, meetingId: "meeting_exec", heldAt: "2025-02-11T12:00:00.000Z", attendees: [], absent: [], quorumMet: false, quorumStatus: "not_recorded", discussion: "", decisions: [], actionItems: [], motionIds: [] }],
} });
let actor = "user_owner";
const runtime = new PortableRuntime({
  db,
  capabilities: makeCapabilities({}),
  principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: actor, userId: actor, societyId: society }),
}).registerAll(PORTABLE_FUNCTIONS);
const as = (user: string) => { actor = user; };
const mutate = (name: string, args: Record<string, unknown>) => runtime.runMutation(name, args) as Promise<any>;
const query = (name: string, args: Record<string, unknown>) => runtime.runQuery(name, args) as Promise<any>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-review-"));
await writeSyntheticFixtures(dir);
const run = await runIntakePipeline(fs.readdirSync(dir).map((name) => ({ fileKey: `local:${name}`, name, path: name, acquisitionStatus: "local" as const, read: async () => new Uint8Array(fs.readFileSync(path.join(dir, name))) })), {
  name: "Synthetic review run", sourceKind: "upload", sourceRoot: "browser upload", extract: (file, bytes) => extractBytes(file.name, bytes), hash: sha256Hex,
});
const staged = await stageRunInWorkspace(mutate, society, run, run.extracts, coverageReport(run, buildImportBundle(run)));
const queue = await query("intake:listExtractions", { societyId: society, runId: staged.runId });
const boardRow = queue.find((row: any) => row.date === "2025-05-13");
const execRow = queue.find((row: any) => row.date === "2025-02-11");
assert.ok(boardRow && execRow);

// ------------------------------------------------------------ pure review model
const board = await query("intake:getExtraction", { societyId: society, extractionId: boardRow._id });
const fields = reviewFieldsForRecord(board.extraction.record);
assert.equal(fields[0].group, "meeting", "header fields come first");
const byPath = new Map(fields.map((field) => [field.path, field]));
assert.equal(byPath.get("date")!.required, true);
assert.equal(byPath.get("body")!.required, true);
assert.equal(byPath.get("motions[2].movedBy")!.label, "Moved by");
assert.equal(byPath.get("motions[2].movedBy")!.kind, "person");
assert.equal(byPath.get("attendance[0].category")!.kind, "enum");
assert.equal(byPath.get("motions[0].text")!.itemIndex, 0);
assert.ok(fields.every((field) => !field.path.includes("personKey")));
assert.equal(thresholdFor("meetingMinutes", "date"), 0.9);
assert.equal(thresholdFor("meetingMinutes", "motions.secondedBy"), 0.85);
assert.equal(thresholdFor("unknownClass", "anything"), 0.85);
assert.equal(thresholdFor("meetingMinutes", "motions.text", { "motions.text": 0.5 }), 0.5);
const stated = (confidence: number, extra: Record<string, unknown> = {}) => ({ path: "motions[0].text", pattern: "motions.text", group: "motions" as const, label: "x", kind: "text" as const, required: false, legalWeight: 5, field: { value: "x", status: "stated" as const, confidence, locators: [{ kind: "block" as const, quote: "x" }], verification: "verified_span" as const, ...extra } });
assert.equal(isBulkEligible(stated(0.9), "meetingMinutes"), true);
assert.equal(isBulkEligible(stated(0.84), "meetingMinutes"), false, "below τ");
assert.equal(isBulkEligible(stated(0.95, { status: "inferred" }), "meetingMinutes"), false, "inferred values are never bulk-accepted");
assert.equal(isBulkEligible(stated(0.95, { status: "conflicting" }), "meetingMinutes"), false, "conflicts need a person");
assert.equal(isBulkEligible(stated(0.95, { verification: "span_mismatch" }), "meetingMinutes"), false, "unverified quotes need a person");
assert.equal(isBulkEligible(stated(0.95, { verification: undefined }), "meetingMinutes"), false);
assert.equal(isBulkEligible(stated(0.95, { locators: [] }), "meetingMinutes"), false);
const none = latestDecisions([]);
const candidates = bulkAcceptCandidates(fields, none, "meetingMinutes");
assert.ok(candidates.length > 20 && candidates.length < fields.length, "bulk accept takes the verified, stated, high-confidence subset");
assert.ok(candidates.some((field) => field.path === "date"));
assert.ok(!candidates.some((field) => field.field.status !== "stated"));
assert.equal(bulkAcceptCandidates(fields, none, "meetingMinutes", { group: "motions" }).every((field) => field.group === "motions"), true);
assert.equal(samplePreview(candidates, 5).length, 5);
assert.deepEqual(samplePreview([1, 2, 3], 5), [1, 2, 3]);
assert.equal(promotionReadiness(fields, none).ready, false);
assert.deepEqual(promotionReadiness(fields, none).missing.sort(), ["Body", "Meeting date"]);
assert.equal(validateEditedValue("date", { iso: "2025-02-30", precision: "day" }), "That day does not exist.");
assert.equal(validateEditedValue("date", { iso: "2025-02", precision: "month" }), null);
assert.equal(validateEditedValue("time", "25:00"), "Use 24-hour HH:MM.");
assert.equal(validateEditedValue("votes", { for: 3, against: -1 }), "Vote counts must be whole numbers of 0 or more.");
assert.deepEqual(nativeTargetForPath("motions[3].movedBy"), { table: "motions", field: "movedBy", item: { group: "motions", index: 3 } });
assert.deepEqual(nativeTargetForPath("attendance[2].category"), { table: "minutes", field: "detailedAttendance.status", item: { group: "attendance", index: 2 } });
assert.deepEqual(nativeTargetForPath("date"), { table: "meetings", field: "scheduledAt" });
assert.deepEqual(nativeTargetForPath("quorum.stated"), { table: "minutes", field: "quorumStatus" });
assert.equal(defaultInfoTypeForPath("motions[1].secondedBy"), "motion.person_link");
assert.equal(defaultInfoTypeForPath("quorum.count"), "quorum.mid_meeting");
assert.equal(landedValue("location", "Room A", "Zoom", true), false, "a merge never attributes a value the record already held differently");
assert.equal(landedValue("location", "Zoom", "Zoom", true), true);
assert.equal(landedValue("scheduledAt", "2025-05-13T12:00:00.000Z", { iso: "2025-05-13", precision: "day" }, true), true);
assert.equal(landedValue("type", "Committee", "operations", true), false);
assert.equal(landedValue("type", "Board", "board", false), true);
// applyReviews keeps only accepted/edited values and drops list items whose key was not promoted.
const decisionsFor = (rows: Array<[string, string, unknown?]>): Map<string, ReviewRow> => latestDecisions(rows.map(([fieldPath, decision, editedValue], index) => ({ fieldPath, decision, editedValue, reviewedAtISO: `2026-01-01T00:00:0${index}.000Z` })));
const appliedSample = applyReviews(board.extraction.record, decisionsFor([["date", "accept"], ["body", "accept"], ["motions[2].text", "accept"], ["motions[2].movedBy", "edit", { nameAsWritten: "A. Quill", resolvedName: "Avery Quill" }], ["attendance[0].nameAsWritten", "accept"], ["motions[0].text", "reject"]]));
assert.equal(appliedSample.record.motions.length, 1, "only the accepted motion survives");
assert.equal(appliedSample.indexMap.motions[2], 0);
assert.equal(appliedSample.record.motions[0].movedBy.value.resolvedName, "Avery Quill");
assert.equal(appliedSample.record.motions[0].outcome.status, "not_stated", "an unreviewed outcome is not promoted");
assert.equal(appliedSample.record.location?.value, undefined);
const later = latestDecisions([{ fieldPath: "date", decision: "reject", reviewedAtISO: "2026-01-01T00:00:00.000Z" }, { fieldPath: "date", decision: "accept", reviewedAtISO: "2026-01-01T00:00:01.000Z" }]);
assert.equal(later.get("date")!.decision, "accept", "the latest decision wins");
// Queue grouping by risk tier then cluster, entities.
const groups = groupQueue(queue, await query("intake:listClusters", { societyId: society, runId: staged.runId }));
assert.ok(groups.length >= 1 && groups.every((group) => ["high", "medium", "low"].includes(group.tier)));
assert.equal(groups.reduce((sum, group) => sum + group.clusters.length, 0) <= queue.length, true);
assert.equal(riskTier({ ...boardRow, verification: { mismatched: 1 } }), "high");
const occurrences = nameOccurrences(board.extraction.record);
assert.ok(occurrences.some((occurrence) => occurrence.kind === "person" && occurrence.name === "Robin Vale"));
const entityRows = entityGroups(occurrences, [{ id: "pd_avery", fullName: "Avery Quill" }, { id: "pd_robin", fullName: "Robin Vale" }]);
const avery = entityRows.find((group) => group.name === "Avery Quill")!;
assert.equal(avery.candidates[0].personId, "pd_avery");
assert.ok(avery.occurrences.length >= 2, "one identity decision covers every occurrence");
const payload = sourceDocumentPayload({ fileKey: "local:x.pdf", name: "x.pdf", sensitivity: "restricted", text: "secret" });
assert.equal(payload.extractedText, undefined, "restricted text never travels with the source document");
assert.equal(payload.mimeType, "application/pdf");
assert.throws(() => buildPromotionBundle({ extraction: { ...board.extraction, docClass: "policy" }, reviews: [], files: [], runName: "x" }), /not supported/);

// ------------------------------------------------------------ entities across the run
const entities = await query("intake:entityCandidates", { societyId: society, extractionId: boardRow._id });
assert.equal(entities.directoryReadable, true);
const averyGroup = entities.groups.find((group: any) => group.name === "Avery Quill");
assert.equal(averyGroup.candidates[0].personId, "pd_avery");
const linked = await mutate("intake:linkNameAcrossRun", { societyId: society, runId: staged.runId, name: "avery quill", personId: "pd_avery" });
assert.ok(linked.occurrences >= averyGroup.occurrences.length, "one decision covers every occurrence in the run");
const linkedReview = db.dump("intakeFieldReviews").find((row: any) => row.decision === "edit" && row.extractionId === boardRow._id) as any;
assert.ok(linkedReview.editedValue === "Avery Quill" || linkedReview.editedValue.resolvedName === "Avery Quill");
await assert.rejects(() => mutate("intake:linkNameAcrossRun", { societyId: society, runId: staged.runId, name: "Avery Quill", personId: "pd_missing" }), /not found/);
await mutate("intake:undoReviews", { societyId: society, reviewIds: linked.reviewIds });
assert.equal(db.dump("intakeFieldReviews").length, 0);

// ------------------------------------------------------------ batched reviews + undo
const accept = (paths: string[]) => paths.map((fieldPath) => ({ extractionId: boardRow._id, fieldPath, decision: "accept" }));
const bulk = await mutate("intake:reviewFields", { societyId: society, items: accept(candidates.map((field) => field.path)) });
assert.equal(bulk.reviewIds.length, candidates.length);
const undone = await mutate("intake:undoReviews", { societyId: society, reviewIds: bulk.reviewIds });
assert.equal(undone.removed, candidates.length, "the undo window removes the whole batch");
assert.equal(db.dump("intakeFieldReviews").length, 0);
await mutate("intake:reviewFields", { societyId: society, items: accept(candidates.map((field) => field.path)) });
await assert.rejects(() => mutate("intake:promoteExtraction", { societyId: society, extractionId: execRow._id }), /Accept or edit the/);
const motionCount = board.extraction.record.motions.length;
const editPath = "motions[2].movedBy";
const original = byPath.get(editPath)!.field.value;
await mutate("intake:reviewFields", { societyId: society, items: [
  { extractionId: boardRow._id, fieldPath: editPath, decision: "edit", editedValue: { ...original, resolvedName: "Avery Quill" }, note: "Confirmed spelling." },
  { extractionId: boardRow._id, fieldPath: "attendance[1].category", decision: "reject" },
  { extractionId: boardRow._id, fieldPath: "quorum.count", decision: "cant_represent", gap: { description: "Head-count of directors present has no native field.", suggestedTarget: "minutes.quorumPresentCount" } },
] });
await assert.rejects(() => mutate("intake:reviewFields", { societyId: society, items: [{ extractionId: boardRow._id, fieldPath: "motions[0].text", decision: "cant_represent" }] }), /Describe what/);
const reviewGap = db.dump("representationGaps").find((row: any) => row.dedupeKey === `intake:${boardRow._id}:quorum.count`) as any;
assert.ok(reviewGap, "can't represent records a system gap at once");
assert.equal(reviewGap.affectedId, undefined);
assert.equal(reviewGap.infoType, "quorum.mid_meeting");
assert.equal(reviewGap.proposedField, "quorumPresentCount");

// ------------------------------------------------------------ merge candidates + promotion
const merge = await query("intake:mergeCandidates", { societyId: society, extractionId: boardRow._id });
assert.equal(merge.date, "2025-05-13");
assert.equal(merge.candidates[0].meetingId, "meeting_board_no_minutes");
assert.equal(merge.candidates[0].sameBody, true);
assert.equal(merge.candidates[0].hasMinutes, false);
as("user_director");
await assert.rejects(() => mutate("intake:promoteExtraction", { societyId: society, extractionId: boardRow._id }), /settings:write/);
as("user_owner");
const promoted = await mutate("intake:promoteExtraction", { societyId: society, extractionId: boardRow._id, mode: "merge", targetMeetingId: "meeting_board_no_minutes" });
assert.equal(promoted.meetingId, "meeting_board_no_minutes", "merging attaches minutes to the meeting that had none");
const meeting = db.dump("meetings").find((row: any) => row._id === promoted.meetingId) as any;
const minutes = db.dump("minutes").find((row: any) => row._id === promoted.minutesId) as any;
assert.equal(meeting.minutesId, promoted.minutesId);
assert.ok(minutes.motionIds.length >= motionCount - 1, "accepted motions became motion rows");
const motionRows = db.dump("motions").filter((row: any) => minutes.motionIds.includes(row._id)) as any[];
assert.ok(motionRows.some((row) => row.movedBy === "Avery Quill"), "the edited (resolved) mover is promoted");
const unknownAttendee = (minutes.detailedAttendance ?? []).find((row: any) => row.name === board.extraction.record.attendance[1].nameAsWritten.value);
assert.equal(unknownAttendee?.status, "unknown", "a rejected category is not guessed");
const meetingProvenance = await query("intake:provenanceForRecord", { societyId: society, targetTable: "meetings", targetId: promoted.meetingId });
assert.ok(meetingProvenance.some((row: any) => row.fieldPath === "scheduledAt" && row.locator.quote === "May 13, 2025"));
const motionProvenance = await query("intake:provenanceForRecord", { societyId: society, targetTable: "motions", targetId: motionRows[0]._id });
assert.ok(motionProvenance.some((row: any) => row.fieldPath === "text"));
const minutesProvenance = await query("intake:provenanceForRecord", { societyId: society, targetTable: "minutes", targetId: promoted.minutesId });
assert.ok(minutesProvenance.some((row: any) => /^detailedAttendance\[\d+\]\.name$/.test(row.fieldPath)));
const allProvenance = await query("intake:provenanceForExtraction", { societyId: society, extractionId: boardRow._id });
assert.equal(allProvenance.length, promoted.provenance);
assert.ok(promoted.notLanded <= 3, `nearly every promoted field lands with a provenance row (${promoted.notLandedPaths.join(", ")})`);
assert.ok((minutes.actionItems ?? []).length > 0, "minutes that had none take the reviewed action items");
assert.ok(allProvenance.some((row: any) => row.decision === "edit" && row.value.resolvedName === "Avery Quill"));
const agendaProvenance = allProvenance.filter((row: any) => row.targetTable === "agendaItems");
assert.ok(agendaProvenance.length >= 5, "accepted section numbers land on agenda items (A9)");
assert.ok(agendaProvenance.every((row: any) => (db.dump("agendaItems").find((item: any) => item._id === row.targetId) as any)?.itemNumber === String(row.value)));
assert.ok(allProvenance.every((row: any) => typeof row.sourceFieldPath === "string"), "every provenance row links back to its reviewed field");
assert.equal((db.dump("representationGaps").find((row: any) => row._id === reviewGap._id) as any).affectedId, promoted.meetingId, "the reviewer gap links to the meeting");
assert.ok(db.dump("representationGaps").some((row: any) => String(row.dedupeKey ?? "").startsWith(`intake:${boardRow._id}:unsupported:`) && row.affectedId === promoted.meetingId), "unsupported details become linked gaps");
assert.equal(promoted.sourceDocuments.length, 1);
const sourceDocument = db.dump("documents").find((row: any) => row._id === promoted.sourceDocuments[0].documentId) as any;
assert.equal(sourceDocument.title, "2025-05-13_Board_Minutes_APPROVED.docx");
assert.equal(sourceDocument.reviewStatus, "transposed", "a promoted source document leaves the review backlog (INT-14)");
assert.ok(minutes.sourceDocumentIds.map(String).includes(String(sourceDocument._id)), "minutes link the source document");
assert.equal((db.dump("intakeFiles").find((row: any) => row.fileKey === boardRow.fileKey) as any).documentId, sourceDocument._id);
assert.equal((db.dump("intakeExtractions").find((row: any) => row._id === boardRow._id) as any).status, "promoted");
await assert.rejects(() => mutate("intake:promoteExtraction", { societyId: society, extractionId: boardRow._id }), /already promoted/);
await assert.rejects(() => mutate("intake:undoReviews", { societyId: society, reviewIds: [db.dump("intakeFieldReviews")[0]._id] }), /promoted/);
const session = db.dump("documents").find((row: any) => row._id === promoted.sessionId) as any;
assert.ok(session && /Intake:/.test(session.title), "promotion leaves an auditable import session");

// Auto mode: a reviewed executive extraction merges into the existing same-date, same-body meeting.
const exec = await query("intake:getExtraction", { societyId: society, extractionId: execRow._id });
const execFields = reviewFieldsForRecord(exec.extraction.record);
await mutate("intake:reviewFields", { societyId: society, items: execFields.filter((field) => field.field.status === "stated" || field.required).map((field) => ({ extractionId: execRow._id, fieldPath: field.path, decision: "accept" })) });
const execMerge = await query("intake:mergeCandidates", { societyId: society, extractionId: execRow._id });
assert.equal(execMerge.candidates[0]?.meetingId, "meeting_exec");
const execPromoted = await mutate("intake:promoteExtraction", { societyId: society, extractionId: execRow._id, mode: "merge", targetMeetingId: "meeting_exec" });
assert.equal(execPromoted.meetingId, "meeting_exec");
assert.equal(execPromoted.merged, true);
const execMinutes = db.dump("minutes").find((row: any) => row._id === "minutes_exec") as any;
assert.ok(execMinutes.motionIds.length > 0, "merged motions were appended to the existing minutes");
assert.ok(execMinutes.sourceExternalIds.includes(execRow.fileKey));

// "New" mode never merges.
const others = queue.filter((row: any) => row._id !== boardRow._id && row._id !== execRow._id && /^\d{4}-\d{2}-\d{2}$/.test(row.date ?? ""));
const other = others[0];
const otherDetail = await query("intake:getExtraction", { societyId: society, extractionId: other._id });
await mutate("intake:reviewFields", { societyId: society, items: reviewFieldsForRecord(otherDetail.extraction.record).filter((field) => field.required || field.pattern === "motions.text").map((field) => ({ extractionId: other._id, fieldPath: field.path, decision: "accept" })) });
const meetingsBefore = db.dump("meetings").length;
const otherPromoted = await mutate("intake:promoteExtraction", { societyId: society, extractionId: other._id, mode: "new" });
assert.equal(db.dump("meetings").length, meetingsBefore + 1);
assert.equal(otherPromoted.merged, false);

// Run-wide bulk accept by class / body-year / cluster, with preview and undo.
const preview = await query("intake:bulkAcceptPreview", { societyId: society, runId: staged.runId, scope: { docClass: "meetingMinutes" } });
assert.ok(preview.count > 0 && preview.sample.length === Math.min(5, preview.count));
assert.ok(preview.sample.every((row: any) => row.quote), "the preview shows each sampled field's source quote");
assert.ok(preview.scopeExtractions >= 3, "promoted extractions are out of scope");
const byYear = await query("intake:bulkAcceptPreview", { societyId: society, runId: staged.runId, scope: { year: "2024" } });
assert.ok(byYear.count < preview.count, "a body-year scope narrows the class scope");
await assert.rejects(() => query("intake:bulkAcceptPreview", { societyId: society, runId: staged.runId, scope: {} }), /Choose a document/);
const reviewsBefore = db.dump("intakeFieldReviews").length;
const bulkRun = await mutate("intake:bulkAccept", { societyId: society, runId: staged.runId, scope: { docClass: "meetingMinutes" } });
assert.equal(bulkRun.fields, preview.count);
assert.equal(db.dump("intakeFieldReviews").length, reviewsBefore + preview.count);
await mutate("intake:undoReviews", { societyId: society, reviewIds: bulkRun.reviewIds });
assert.equal(db.dump("intakeFieldReviews").length, reviewsBefore, "the whole run-wide batch can be undone");

// Server-side reconciliation (hosted runs) and run summaries.
const reconciled = await mutate("intake:reconcileRun", { societyId: society, runId: staged.runId });
assert.ok(reconciled.meetings >= 5);
assert.ok(reconciled.recordGaps >= 1);
const summaries = await query("intake:runSummaries", { societyId: society });
assert.equal(summaries[0].promoted, 3);
assert.ok(summaries[0].promotedFields >= promoted.provenance);
assert.ok(summaries[0].promotedCoverage > 0 && summaries[0].promotedCoverage <= 1, "reviewed native coverage = promoted fields ÷ extracted facts");
assert.ok(summaries[0].systemGaps >= 2, "run summaries count the system gaps the run produced");
as("user_member");
await assert.rejects(() => query("intake:runSummaries", { societyId: society }), /settings:read/);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`PASS intake review: ${fields.length} reviewable fields, ${candidates.length} bulk-eligible (stated, span-verified, ≥ τ); batched reviews undo; can't-represent gaps link on promotion; promotion through import sessions wrote ${promoted.provenance} provenance rows, linked the source document, merged into existing meetings and respected roles`);
