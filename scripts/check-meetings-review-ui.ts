// WP-G gate: meetings & minutes editing surface (ui-meetings F2–F29, schema B3/B4/B5/B8,
// ui-people P9). Synthetic names only; runs on the local StaticConvexClient
// (real portable handlers) — no live backend.
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { bodyPatchForValue, bodyValueForMeeting, meetingBodyLabel, meetingBodyOptions, bodyChoiceIssue } from "../shared/meetingBodyPicker";
import { meetingDateDraftFrom, meetingDatePatchFromDraft, meetingDateDraftIssue, zonedLocalToUtcISO } from "../shared/meetingDateEdit";
import { formatMeetingDate } from "../shared/meetingDates";
import { minutesApprovalIssues, approvingMeetingCandidates } from "../shared/meetingApproval";
import {
  attendanceCounts,
  attendancePatchFromRows,
  attendanceRowSuggestion,
  attendanceRowsFromMinutes,
  attendanceRowsFromPaste,
  attendanceRowsFromSourceParticipants,
  matchDirectoryPerson,
  minutesPresentCount,
} from "../shared/meetingAttendanceGrid";
import { duplicateMeetingGroups, planMeetingMerge, meetingDuplicateKey } from "../shared/meetingMerge";
import { summarizeMinutes } from "../shared/functions/minutesSummaries";

// ---------- body picker (B8) --------------------------------------------------
const committees = [{ _id: "c_exec", name: "Executive Committee" }, { _id: "c_ops", name: "Operations Committee" }];
const options = meetingBodyOptions(committees);
assert.ok(options.some((row) => row.value === "board:special"));
assert.ok(options.some((row) => row.value === "committee:c_exec:special"));
assert.deepEqual(bodyPatchForValue("committee:c_exec"), { type: "Committee", committeeId: "c_exec", special: false, hostBody: "own" });
assert.deepEqual(bodyPatchForValue("board:special"), { type: "Board", clearCommitteeId: true, special: true, hostBody: "own" });
assert.equal(bodyPatchForValue("external").hostBody, "external");
for (const value of ["board", "board:special", "agm", "sgm", "committee:c_ops", "committee:c_ops:special"]) {
  const patch = bodyPatchForValue(value);
  assert.equal(bodyValueForMeeting({ ...patch, committeeId: patch.committeeId ?? null }), value, value);
}
assert.equal(meetingBodyLabel({ type: "Committee", committeeId: "c_exec", special: true }, committees), "Special — Executive Committee");
assert.match(String(bodyChoiceIssue("external", "")), /external organization/);
assert.equal(bodyChoiceIssue("committee:c_ops", undefined), null);
console.log("✓ body picker: board, special, AGM/SGM, committees, external");

// ---------- date edit (A13, F3/F14) -------------------------------------------
const dateOnly = { scheduledAt: "2013-05-14T12:00:00.000Z", scheduledAtPrecision: "date", localStartText: "3:00 PM", localEndText: "4:00 PM" };
assert.equal(formatMeetingDate(dateOnly, { timeZone: "America/Vancouver" }), "May 14, 2013 · 3:00 PM – 4:00 PM".replace("May 14, 2013", new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date("2013-05-14T12:00:00Z"))));
assert.doesNotMatch(formatMeetingDate({ scheduledAt: "2013-05-14T12:00:00.000Z" }, { timeZone: "America/Vancouver" }), /AM|PM|a\.m\.|p\.m\./, "noon placeholder never shows a clock time");
const draft = meetingDateDraftFrom(dateOnly, "America/Vancouver");
assert.equal(draft.date, "2013-05-14");
assert.equal(draft.precision, "date");
assert.equal(meetingDatePatchFromDraft(draft)?.scheduledAt, "2013-05-14T12:00:00.000Z");
const timed = { ...draft, precision: "datetime" as const, time: "18:30", timeZone: "America/Vancouver" };
assert.equal(meetingDatePatchFromDraft(timed)?.scheduledAt, "2013-05-15T01:30:00.000Z", "PDT is UTC-7");
assert.equal(zonedLocalToUtcISO("2021-01-12", "18:00", "America/Vancouver"), "2021-01-13T02:00:00.000Z", "PST is UTC-8");
assert.equal(meetingDateDraftFrom({ scheduledAt: "2013-05-15T01:30:00.000Z", scheduledAtPrecision: "datetime", timeZone: "America/Vancouver" }).time, "18:30");
assert.match(String(meetingDateDraftIssue({ ...timed, time: "" })), /start time/);
assert.match(String(meetingDateDraftIssue({ ...timed, timeZone: "Mars/Olympus" })), /time zone/);
console.log("✓ date edit: date-only placeholder, local time in zone, DST, validation");

// ---------- approval checks (F8) ----------------------------------------------
const meeting = { _id: "m1", scheduledAt: "2013-05-14T12:00:00.000Z" };
const next = { _id: "m2", scheduledAt: "2013-06-11T12:00:00.000Z" };
assert.deepEqual(minutesApprovalIssues({ approvedOn: "2013-06-11", meeting, approvingMeeting: next, today: "2026-10-07" }), []);
assert.match(minutesApprovalIssues({ approvedOn: "2026-10-06", meeting, approvingMeeting: next, today: "2026-10-07" })[0], /does not match/);
assert.match(minutesApprovalIssues({ approvedOn: "2013-05-01", meeting, today: "2026-10-07" })[0], /before the meeting/);
assert.match(minutesApprovalIssues({ approvedOn: "2013-06-11", meeting, approvingMeeting: { _id: "m0", scheduledAt: "2013-04-01T12:00:00.000Z" }, today: "2026-10-07" })[0], /must be after/);
assert.match(minutesApprovalIssues({ approvedOn: "2030-01-01", meeting, today: "2026-10-07" }).join(" "), /future/);
assert.deepEqual(approvingMeetingCandidates(meeting, [next, { _id: "m0", scheduledAt: "2013-04-01T12:00:00.000Z" }, meeting]).map((row) => row._id), ["m2"]);
console.log("✓ approval: before meeting, approving meeting order and date, future dates");

// ---------- attendance grid (B4/B5, F5/F13, P9) -------------------------------
const people = [{ _id: "p_alex", fullName: "Alex Example" }, { _id: "p_blair", fullName: "Blair Sample", aliases: ["B. Sample"] }];
assert.equal(matchDirectoryPerson("alex  EXAMPLE", people)?._id, "p_alex");
assert.equal(matchDirectoryPerson("B. Sample", people)?._id, "p_blair");
assert.equal(matchDirectoryPerson("Alex", people), undefined);
const legacyMinutes = { attendees: ["Alex Example", "Vice President", "Blair Sample, Ministry of Examples"], absent: ["Members"] };
const rows = attendanceRowsFromMinutes(legacyMinutes, [{ _id: "r1", personName: "Alex Example", attendanceStatus: "present", directoryPersonId: "p_alex" }, { _id: "r2", personName: "Casey Gone", attendanceStatus: "removed" }]);
assert.equal(rows.length, 4, "register rows marked removed are not resurrected");
assert.equal(rows[0].recordId, "r1");
assert.equal(rows[0].personId, "p_alex");
assert.equal(attendanceRowSuggestion(rows[1])?.kind, "not_person", "role word");
assert.equal(attendanceRowSuggestion(rows[3])?.kind, "not_person", "heading");
const split = attendanceRowSuggestion(rows[2]);
assert.equal(split?.kind, "split");
assert.equal(split && split.kind === "split" ? split.affiliation : "", "Ministry of Examples");
assert.equal(attendanceRowSuggestion({ name: "Blair Sample" }, people)?.kind, "link");
const pasted = attendanceRowsFromPaste("Alex Example\nBlair Sample (Chair)\n• Jo Guest, City of Example", "guest");
assert.deepEqual(pasted.map((row) => [row.name, row.status, row.roleTitle ?? "", row.affiliation ?? ""]), [
  ["Alex Example", "guest", "", ""], ["Blair Sample", "guest", "Chair", ""], ["Jo Guest", "guest", "", "City of Example"],
]);
const fromSource = attendanceRowsFromSourceParticipants([{ name: "Alex Example", category: "present", affiliation: "Secretary" }, { name: "Jo Guest", category: "regrets", affiliation: "City of Example" }]);
assert.deepEqual(fromSource.map((row) => [row.name, row.status, row.roleTitle ?? "", row.affiliation ?? ""]), [["Alex Example", "present", "Secretary", ""], ["Jo Guest", "regrets", "", "City of Example"]]);
const gridRows = [
  { key: "a", name: "Alex Example", status: "present" as const, personId: "p_alex", quorumCounted: true },
  { key: "b", name: "Blair Sample", status: "proxy" as const, proxyFor: "Casey Rep" },
  { key: "c", name: "Dana Staff", status: "staff" as const, quorumCounted: false },
  { key: "d", name: "Erin Away", status: "regrets" as const },
  { key: "e", name: "erin away", status: "present" as const },
  { key: "f", name: "Fran Unknown", status: "unknown" as const },
];
const patch = attendancePatchFromRows(gridRows);
assert.deepEqual(patch.attendees, ["Alex Example", "Blair Sample", "Dana Staff"]);
assert.deepEqual(patch.absent, ["Erin Away"]);
assert.equal(patch.detailedAttendance.length, 5, "duplicate names collapse");
assert.equal(patch.detailedAttendance.find((row) => row.name === "Blair Sample")?.quorumCounted, true, "proxies count by default");
assert.deepEqual(attendanceCounts(gridRows), { present: 2, inAttendance: 4, notAttending: 1, quorumCounted: 2, total: 6 });
assert.equal(minutesPresentCount({ detailedAttendance: patch.detailedAttendance }), 1);
console.log("✓ attendance grid: register merge, screening suggestions, paste, source participants, derived lists and counts");

// ---------- duplicates and merge plan (F17) -----------------------------------
const meetings = [
  { _id: "a", type: "Committee", committeeId: "c_exec", scheduledAt: "2013-05-14T12:00:00.000Z", title: "2013-05-14 ExecMinutes DRAFT.docx" },
  { _id: "b", type: "Committee", committeeId: "c_exec", scheduledAt: "2013-05-14T12:00:00.000Z", title: "2013-05-14 ExecMinutes.pdf" },
  { _id: "c", type: "AGM", scheduledAt: "2013-05-14T12:00:00.000Z", title: "AGM" },
  { _id: "d", type: "Board", scheduledAt: "2013-05-14T12:00:00.000Z", title: "Board", status: "Cancelled" },
];
const groups = duplicateMeetingGroups(meetings, committees);
assert.equal(groups.length, 1, "AGM and an executive meeting on one evening are not duplicates");
assert.deepEqual(groups[0].meetings.map((row) => row._id), ["a", "b"]);
assert.equal(meetingDuplicateKey(meetings[0], committees), "2013-05-14|committee:executive");
const plan = planMeetingMerge({
  target: meetings[1], duplicate: meetings[0], committees,
  targetMinutes: { attendees: ["Alex Example"], sourceExternalIds: ["drive:pdf"] },
  duplicateMinutes: { attendees: ["alex example", "Blair Sample"], sourceExternalIds: ["drive:pdf", "drive:docx"], sections: [{}, {}] },
  targetMotions: [{ _id: "mt", text: "To adopt the agenda." }],
  duplicateMotions: [{ _id: "md1", text: "To adopt the agenda" }, { _id: "md2", text: "To approve the budget" }],
});
assert.deepEqual(plan.blockers, []);
assert.deepEqual(plan.sourceExternalIdsAdded, ["drive:docx"]);
assert.deepEqual(plan.motionsToMove, ["md2"]);
assert.deepEqual(plan.motionsDuplicate, ["md1"]);
assert.deepEqual(plan.attendeesOnlyInDuplicate, ["Blair Sample"]);
assert.equal(plan.versionStatus, "draft");
assert.match(planMeetingMerge({ target: meetings[1], duplicate: meetings[0], targetMinutes: { approvedAt: "2013-06-11" } }).blockers[0], /approved/);
assert.ok(planMeetingMerge({ target: meetings[2], duplicate: meetings[0], committees }).warnings.some((warning) => /different bodies/.test(warning)));
console.log("✓ merge plan: same-day same-body groups, motions, sources, attendance, approval blockers");

// ---------- portable handlers (local runtime) ---------------------------------
const societyId = "wpg_society";
const now = new Date().toISOString();
const client = new StaticConvexClient({ seed: {
  societies: [{ _id: societyId, name: "Meetings UI Test", jurisdictionCode: "CA-BC", entityType: "society" }],
  committees: [{ _id: "c_exec", societyId, name: "Executive Committee", status: "Active", createdAtISO: now }],
  peopleDirectory: [
    { _id: "p_alex", societyId, fullName: "Alex Example", searchName: "alex example", createdAtISO: now, updatedAtISO: now },
    { _id: "p_blair", societyId, fullName: "Blair Sample", searchName: "blair sample", createdAtISO: now, updatedAtISO: now },
  ],
  meetings: [
    { _id: "m_keep", societyId, type: "Committee", committeeId: "c_exec", title: "Executive meeting — 2013-05-14", scheduledAt: "2013-05-14T12:00:00.000Z", scheduledAtPrecision: "date", electronic: false, status: "Held", attendeeIds: [], minutesId: "min_keep" },
    { _id: "m_dup", societyId, type: "Committee", committeeId: "c_exec", title: "2013-05-14 ExecMinutes DRAFT.docx", scheduledAt: "2013-05-14T12:00:00.000Z", electronic: false, status: "Held", attendeeIds: [], minutesId: "min_dup" },
    { _id: "m_next", societyId, type: "Committee", committeeId: "c_exec", title: "Executive meeting — 2013-06-11", scheduledAt: "2013-06-11T12:00:00.000Z", electronic: false, status: "Held", attendeeIds: [] },
  ],
  minutes: [
    { _id: "min_keep", societyId, meetingId: "m_keep", heldAt: "2013-05-14T12:00:00.000Z", attendees: ["Alex Example", "Vice President", "Members"], absent: [], quorumMet: false, discussion: "Kept.", decisions: [], actionItems: [], sections: [{ title: "Welcome", actionItems: [{ text: "Send the plan", done: false, status: "open" }] }], sourceExternalIds: ["drive:pdf"], motionIds: ["mo_keep"] },
    { _id: "min_dup", societyId, meetingId: "m_dup", heldAt: "2013-05-14T12:00:00.000Z", attendees: ["Alex Example", "Blair Sample"], absent: [], quorumMet: false, discussion: "Draft copy.", decisions: [], actionItems: [], sections: [{ title: "Welcome" }], sourceExternalIds: ["drive:pdf", "drive:docx"], motionIds: ["mo_same", "mo_new"] },
  ],
  motions: [
    { _id: "mo_keep", societyId, minutesId: "min_keep", primaryMeetingId: "m_keep", text: "To adopt the agenda", status: "Voted", outcome: "Carried", source: "minutes", createdAtISO: now, updatedAtISO: now },
    { _id: "mo_same", societyId, minutesId: "min_dup", primaryMeetingId: "m_dup", text: "To adopt the agenda.", status: "Moved", source: "minutes", createdAtISO: now, updatedAtISO: now },
    { _id: "mo_new", societyId, minutesId: "min_dup", primaryMeetingId: "m_dup", text: "To approve the work plan", status: "Moved", source: "minutes", createdAtISO: now, updatedAtISO: now },
  ],
  meetingAttendanceRecords: [
    { _id: "rec_vp", societyId, meetingId: "m_keep", minutesId: "min_keep", meetingTitle: "Executive meeting", meetingDate: "2013-05-14", personName: "Vice President", attendanceStatus: "present", confidence: "Low", createdAtISO: now },
    { _id: "rec_dup", societyId, meetingId: "m_dup", minutesId: "min_dup", meetingTitle: "Draft", meetingDate: "2013-05-14", personName: "Blair Sample", attendanceStatus: "present", confidence: "Low", createdAtISO: now },
  ],
  personOccurrences: [
    { _id: "occ_vp", societyId, occurrenceKey: "k1", recordTable: "minutes", recordId: "min_keep", personName: "Vice President", context: "attendance", sourceUrl: "https://example.org", sourceReference: "p1", matchStatus: "suggested", reviewHistory: [], createdAtISO: now },
  ],
  tasks: [{ _id: "t_dup", societyId, meetingId: "m_dup", title: "Follow up", status: "Todo", priority: "Medium", tags: [], createdAtISO: now }],
  agendas: [{ _id: "ag_dup", societyId, meetingId: "m_dup", title: "Agenda", status: "Draft", createdAtISO: now, updatedAtISO: now }],
  agendaItems: [{ _id: "ai_dup", societyId, agendaId: "ag_dup", order: 0, type: "discussion", title: "Welcome", createdAtISO: now }],
} });
await client.whenLocalWorkspaceReady();
const tables = () => client.exportLocalWorkspaceSnapshot().tables as Record<string, any[]>;

const summaries: any[] = await client.query("minutes:listSummaries", { societyId });
const keepSummary = summaries.find((row) => row.meetingId === "m_keep");
assert.equal(keepSummary.motionCount, 1);
assert.equal(keepSummary.openActionItemCount, 1, "section actions count (F19)");
assert.equal(keepSummary.started, true);
assert.equal(JSON.stringify(summaries).includes("Kept."), false, "summaries carry no minutes text");
assert.equal(summarizeMinutes({ _id: "x", meetingId: "y", sections: [] }).started, false);

// Edit meeting: body + special + date precision + times.
await client.mutation("meetings:update", { id: "m_keep", patch: { ...bodyPatchForValue("committee:c_exec:special"), ...meetingDatePatchFromDraft({ date: "2013-05-14", precision: "date", time: "", timeZone: "America/Vancouver", localStartText: "3:00 PM", localEndText: "4:00 PM" })! } });
const edited = tables().meetings.find((row) => row._id === "m_keep");
assert.equal(edited.special, true);
assert.equal(edited.scheduledAt, "2013-05-14T12:00:00.000Z");
assert.equal(edited.localStartText, "3:00 PM");

// Attendance grid save: not-a-person corrections update counts at once (P9).
const result: any = await client.mutation("minutes:saveAttendanceGrid", {
  minutesId: "min_keep",
  rows: [
    { name: "Alex Example", status: "present", personId: "p_alex", quorumCounted: true, roleTitle: "Chair" },
    { name: "Blair Sample", status: "regrets", affiliation: "Ministry of Examples", representedOrganization: "Ministry of Examples" },
  ],
  nonPersons: [{ name: "Vice President", kind: "role" }, { name: "Members", kind: "heading" }],
});
assert.equal(result.attendees, 1);
assert.equal(result.nonPersons, 2);
const savedMinutes = tables().minutes.find((row) => row._id === "min_keep");
assert.deepEqual(savedMinutes.attendees, ["Alex Example"]);
assert.deepEqual(savedMinutes.absent, ["Blair Sample"]);
assert.equal(savedMinutes.detailedAttendance[0].personId, "p_alex");
assert.equal(JSON.parse(savedMinutes.draftTranscript).nonPersonAttendance.length, 2);
assert.deepEqual(tables().meetings.find((row) => row._id === "m_keep").attendeeIds, ["Alex Example"]);
const records = tables().meetingAttendanceRecords.filter((row) => row.meetingId === "m_keep");
assert.equal(records.find((row) => row._id === "rec_vp").attendanceStatus, "not_person", "register keeps the evidence row");
assert.equal(records.find((row) => row.personName === "Alex Example")?.directoryPersonId, "p_alex");
assert.equal(records.find((row) => row.personName === "Blair Sample")?.representedOrganization, "Ministry of Examples");
assert.equal(tables().personOccurrences.find((row) => row._id === "occ_vp").matchStatus, "not_person");
const after: any[] = await client.query("minutes:listSummaries", { societyId });
assert.equal(after.find((row) => row.meetingId === "m_keep").presentCount, 1);
await assert.rejects(client.mutation("minutes:saveAttendanceGrid", { minutesId: "min_keep", rows: [{ name: "X", status: "present", personId: "p_missing" }] }));
console.log("✓ attendance save: minutes lists, detailed rows, meeting ids, register, occurrences, non-person evidence");

// Merge preview + merge.
const preview: any = await client.query("meetings:mergePreview", { targetId: "m_keep", duplicateId: "m_dup" });
assert.deepEqual(preview.motionsToMove, ["mo_new"]);
assert.ok(preview.references.tasks >= 1);
assert.equal(preview.duplicate.date, "2013-05-14");
const merged: any = await client.mutation("meetings:merge", { targetId: "m_keep", duplicateId: "m_dup" });
assert.equal(merged.motionsMoved, 1);
const t = tables();
assert.equal(t.meetings.some((row) => row._id === "m_dup"), false);
assert.equal(t.minutes.some((row) => row._id === "min_dup"), false);
const kept = t.minutes.find((row) => row._id === "min_keep");
assert.deepEqual(kept.motionIds, ["mo_keep", "mo_new"]);
assert.equal(kept.importedSourceVersions.length, 1);
assert.equal(kept.importedSourceVersions[0].status, "draft");
assert.match(kept.importedSourceVersions[0].contentJson, /Draft copy\./);
assert.deepEqual(kept.sourceExternalIds, ["drive:pdf", "drive:docx"]);
assert.equal(t.motions.find((row) => row._id === "mo_new").minutesId, "min_keep");
assert.equal(t.motions.some((row) => row._id === "mo_same"), false);
assert.equal(t.tasks.find((row) => row._id === "t_dup").meetingId, "m_keep");
assert.equal(t.meetingAttendanceRecords.find((row) => row._id === "rec_dup").meetingId, "m_keep");
assert.equal(t.meetingAttendanceRecords.find((row) => row._id === "rec_dup").minutesId, "min_keep");
assert.equal(t.agendas.find((row) => row._id === "ag_dup")?.meetingId, "m_keep", "the kept meeting had no agenda, so the duplicate's moves over");
assert.match(t.meetings.find((row) => row._id === "m_keep").sourceReviewNotes, /Merged duplicate/);
await assert.rejects(client.query("meetings:mergePreview", { targetId: "m_keep", duplicateId: "m_dup" }));
console.log("✓ merge: version snapshot, motions moved/dropped, references re-pointed, duplicate deleted");

// Approved minutes are never merged.
await client.mutation("minutes:update", { id: "min_keep", patch: { approvedAt: "2013-06-11T12:00:00.000Z", approvedInMeetingId: "m_next" } });
await assert.rejects(client.mutation("meetings:merge", { targetId: "m_keep", duplicateId: "m_next" }), /approved/);
await assert.rejects(client.mutation("minutes:saveAttendanceGrid", { minutesId: "min_keep", rows: [] }), /frozen/);
console.log("✓ approved minutes block merge and attendance edits");
console.log("meetings review UI gate passed");
