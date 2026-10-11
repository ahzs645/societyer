// Retest gate (meetings area): fixes found while correcting imported minutes
// end to end. Synthetic names only; runs the real portable handlers on the
// local StaticConvexClient — no live backend.
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { minutesTextForDisplay } from "../shared/minutesMarkdownText";
import { clockTextTo24h } from "../shared/meetingDateEdit";
import { cleanSourceLocation } from "../shared/meetingSourceHeader";
import { attendanceRowsFromPaste, blankAttendanceRow, mergeAttendanceRows } from "../shared/meetingAttendanceGrid";
import { renderMinutesHtml } from "../src/features/meetings/lib/minutesRenderer";
import { effectiveSourceFidelity } from "../src/features/meetings/lib/minutesExportPrefs";
import { defaultNewMeetingStart, meetingCreateLabels, pastNoticeDateValue } from "../src/features/meetings/lib/noticeWindow";
import { approvingMeetingCandidates, minutesApprovalIssues } from "../shared/meetingApproval";
import { upcomingMeetingsFromISO } from "../shared/functions/dashboard";
import { alignSectionsToAgenda } from "../src/features/meetings/lib/agendaSectionAlign";
import { preferredMeetingToKeep } from "../shared/meetingMerge";
import { formalMinutesExportBlockers, suggestedMeetingTitle, titleForChangedDate } from "../src/features/meetings/lib/meetingDetailHelpers";
import { duplicateActionRows, plainActionWording, suggestedActionOwner } from "../src/features/meetings/lib/actionItemTidy";
import { agendaOnlyMeetingStatus } from "../shared/meetingStatus";
import { officerNamesFromAttendance } from "../src/features/meetings/lib/officerNames";

// ---------- rich-editor markdown is shown without escapes ---------------------
// What the rich editor saves after a no-change round trip of imported text.
const saved = "Cashflow is good.\\\nMay need a new agreement | Alex to revise accounts |\n\\| Blair has a candidate list |\n6\\. Next Board Meeting\nCost is 5 \\* 3";
const shown = minutesTextForDisplay(saved);
assert.equal(shown.includes("\\"), true, "a literal \\* stays escaped (only * and ` keep their escape)");
assert.doesNotMatch(shown.replace("\\*", ""), /\\/, "no stray backslashes from hard breaks or punctuation escapes");
assert.match(shown, /^Cashflow is good\.\nMay need/);
assert.match(shown, /\n\| Blair has/);
assert.match(shown, /\n6\. Next Board Meeting/);
assert.equal(minutesTextForDisplay("line one  \nline two"), "line one\nline two");
console.log("✓ minutes text: backslash hard breaks and punctuation escapes removed for display");

// ---------- "Use source time" parses the stated start -------------------------
assert.equal(clockTextTo24h("3:00 PM"), "15:00");
assert.equal(clockTextTo24h("6 p.m."), "18:00");
assert.equal(clockTextTo24h("12:30 am"), "00:30");
assert.equal(clockTextTo24h("noon"), "12:00");
assert.equal(clockTextTo24h("18:45"), "18:45");
assert.equal(clockTextTo24h("6"), undefined);
assert.equal(clockTextTo24h("TBD"), undefined);
assert.equal(clockTextTo24h("13:00 PM"), undefined);
console.log("✓ source time: clock text → 24h start time");

assert.equal(cleanSourceLocation("ZoomSubject: \tMeeting MinutesZoom: Link"), "Zoom");
assert.equal(cleanSourceLocation("Room 207 – 155 George Street, Prince George, BC"), "Room 207 – 155 George Street, Prince George, BC");
assert.equal(cleanSourceLocation("Zoom: https://example.org/j/1"), "Zoom: https://example.org/j/1");
console.log("✓ source location: run-on header lines trimmed");

// ---------- attendance: source roles fill existing rows -----------------------
const current = [blankAttendanceRow({ name: "Alex Example" }), blankAttendanceRow({ name: "Blair Sample", roleTitle: "Chair" })];
const merged = mergeAttendanceRows(current, [
  blankAttendanceRow({ name: "alex example", roleTitle: "President", affiliation: "Example Society" }),
  blankAttendanceRow({ name: "Blair Sample", roleTitle: "Treasurer" }),
  blankAttendanceRow({ name: "Casey Demo", roleTitle: "Secretary" }),
]);
assert.equal(merged.added, 1);
assert.equal(merged.filled, 1);
assert.equal(merged.rows.find((row) => row.name === "Alex Example")?.roleTitle, "President", "blank role filled from source");
assert.equal(merged.rows.find((row) => row.name === "Blair Sample")?.roleTitle, "Chair", "typed role kept");
assert.equal(merged.rows.length, 3);
console.log("✓ attendance merge: no duplicates, blank roles filled, typed values kept");

const pasted = attendanceRowsFromPaste("Casey Demo (Note-taker), Example Society\nDrew Sample, Example Council", "staff");
assert.deepEqual(pasted.map((row) => [row.name, row.roleTitle ?? "", row.affiliation ?? "", row.status]), [
  ["Casey Demo", "Note-taker", "Example Society", "staff"],
  ["Drew Sample", "", "Example Council", "staff"],
]);
console.log("✓ attendance paste: “Name (Role), Affiliation” splits into its parts");

// ---------- section save + agenda re-sync keeps actions and motion links -------
const societyId = "retest_society";
const now = new Date().toISOString();
const client = new StaticConvexClient({ seed: {
  societies: [{ _id: societyId, name: "Retest Society", jurisdictionCode: "CA-BC", entityType: "society" }],
  peopleDirectory: [
    { _id: "p_alex", societyId, fullName: "Alex Example", searchName: "alex example", createdAtISO: now, updatedAtISO: now },
    { _id: "p_blair", societyId, fullName: "Blair Sample", searchName: "blair sample", createdAtISO: now, updatedAtISO: now },
  ],
  meetings: [{ _id: "m1", societyId, type: "Board", title: "Board meeting", scheduledAt: "2021-02-23T12:00:00.000Z", scheduledAtPrecision: "date", electronic: true, status: "Held", attendeeIds: [], minutesId: "min1" }],
  minutes: [{ _id: "min1", societyId, meetingId: "m1", heldAt: "2021-02-23T12:00:00.000Z", attendees: [], absent: [], quorumMet: false, discussion: "", decisions: [], actionItems: [], sections: [{ title: "Budget" }, { title: "Work plan" }], motionIds: ["mo1"] }],
  motions: [{
    _id: "mo1", societyId, minutesId: "min1", primaryMeetingId: "m1", text: "To approve the 2021 draft budget", status: "Voted", outcome: "Carried", source: "minutes",
    movedBy: "Alex Example", movedByPersonId: "p_alex", secondedBy: "Blair Sample", secondedByPersonId: "p_blair",
    opposedBy: [{ name: "Blair Sample", personId: "p_blair" }], sourceOutcomeText: "approved", outcomeOverrideNote: "Consensus recorded by the chair",
    sectionIndex: 0, sectionTitle: "Budget", createdAtISO: now, updatedAtISO: now,
  }],
} });
await client.whenLocalWorkspaceReady();
const tables = () => client.exportLocalWorkspaceSnapshot().tables as Record<string, any[]>;
const sections = [
  { title: "Budget", discussion: "Carry-forward reviewed." },
  { title: "Work plan", actionItems: [{ text: "Send feedback on the work plan", assignee: "Alex Example", assigneePersonId: "p_alex", dueDate: "March 8", status: "open", done: false }] },
];
// The meeting page saves sections, then re-syncs the agenda from them.
await client.mutation("minutes:update", { id: "min1", patch: { sections } });
await client.mutation("agendas:syncForMeeting", { societyId, meetingId: "m1", title: "Board agenda", items: sections.map((section) => ({ title: section.title, depth: 0, type: "discussion", details: section.discussion })) });
const minutesRow = tables().minutes.find((row) => row._id === "min1");
const action = minutesRow.sections.find((section: any) => section.title === "Work plan").actionItems[0];
assert.equal(action.status, "open", "action status survives the agenda re-sync");
assert.equal(action.assigneePersonId, "p_alex", "action owner link survives the agenda re-sync");
assert.equal(action.dueDate, "March 8");
const motion = tables().motions.find((row) => row.minutesId === "min1");
assert.ok(motion, "motion row kept");
assert.equal(motion.movedByPersonId, "p_alex", "mover link survives a section save");
assert.equal(motion.secondedByPersonId, "p_blair", "seconder link survives a section save");
assert.equal(motion.opposedBy?.[0]?.personId, "p_blair", "named opposers survive");
assert.equal(motion.outcomeOverrideNote, "Consensus recorded by the chair", "override note survives");
assert.equal(motion.sourceOutcomeText, "approved", "source outcome wording survives");
console.log("✓ agenda re-sync keeps action status/owner links and motion person links, dissent and notes");

// Backup round trip of corrected, approved minutes: the adopted copy, action
// owners and motion person links come back intact.
{
  await client.mutation("minutes:update", { id: "min1", patch: { approvedAt: "2021-03-30T07:00:00.000Z", clearApprovedInMeeting: true } });
  const backup = JSON.parse(JSON.stringify(client.exportLocalWorkspaceSnapshot()));
  const restoredClient = new StaticConvexClient({ seed: { societies: [] } });
  await restoredClient.importLocalWorkspaceSnapshot(backup);
  const back = restoredClient.exportLocalWorkspaceSnapshot().tables as Record<string, any[]>;
  const before = tables();
  const restoredMinutes = back.minutes.find((row) => row._id === "min1");
  assert.ok(restoredMinutes.approvedAt && restoredMinutes.adoptedSnapshot, "approval and the adopted copy survive a backup restore");
  assert.deepEqual(restoredMinutes.adoptedSnapshot, before.minutes.find((row) => row._id === "min1").adoptedSnapshot);
  assert.equal(restoredMinutes.sections.find((section: any) => section.title === "Work plan").actionItems[0].assigneePersonId, "p_alex");
  const restoredMotion = back.motions.find((row) => row.minutesId === "min1");
  assert.equal(restoredMotion.movedByPersonId, "p_alex");
  assert.equal(restoredMotion.secondedByPersonId, "p_blair");
  await assert.rejects(() => restoredClient.mutation("minutes:update", { id: "min1", patch: { discussion: "Edited after restore" } }), /frozen|adopted|approved/i, "restored adopted minutes stay frozen");
  await client.mutation("minutes:update", { id: "min1", patch: { clearApproval: true } });
  assert.equal(tables().minutes.find((row) => row._id === "min1").approvedAt, undefined, "reopening clears the approval");
}
console.log("✓ backup restore keeps approved minutes, the adopted copy, action owners and motion person links");

// Reordering the agenda moves each motion with its section; a motion whose
// section disappears stays in the minutes, unassigned.
await client.mutation("minutes:update", { id: "min1", patch: { sections: [
  { title: "Budget", discussion: "Carry-forward reviewed." },
  { title: "Work plan", discussion: "Plan discussed." },
  { title: "Scratch item" },
], motions: [
  { motionId: "mo1", text: "To approve the 2021 draft budget", outcome: "Carried", sectionIndex: 0, sectionTitle: "Budget", movedByPersonId: "p_alex" },
  { text: "To adopt the work plan", outcome: "Carried", sectionIndex: 1, sectionTitle: "Work plan" },
  { text: "To note the scratch item", outcome: "Carried", sectionIndex: 2, sectionTitle: "Scratch item" },
] } });
await client.mutation("agendas:syncForMeeting", { societyId, meetingId: "m1", title: "Board agenda", items: [
  { title: "Work plan", depth: 0 }, { title: "Budget", depth: 0 },
] });
const reorderedMotions = tables().motions.filter((row) => row.minutesId === "min1");
const byText = (text: string) => reorderedMotions.find((row) => row.text === text);
assert.equal(reorderedMotions.length, 3, "no motion is lost when the agenda changes");
assert.deepEqual([byText("To adopt the work plan")?.sectionIndex, byText("To approve the 2021 draft budget")?.sectionIndex], [0, 1], "motions follow their sections");
assert.equal(byText("To note the scratch item")?.sectionIndex, undefined, "a motion on a dropped, empty section is kept unassigned");
assert.equal(byText("To approve the 2021 draft budget")?.movedByPersonId, "p_alex");
console.log("✓ agenda reorder: motions follow their sections; none are lost");

// ---------- exports show corrected text and actions ----------------------------
const html = renderMinutesHtml({
  society: { name: "Retest Society" } as any,
  meeting: { title: "Board meeting", scheduledAt: "2021-02-23T12:00:00.000Z", scheduledAtPrecision: "date", type: "Board" } as any,
  minutes: {
    heldAt: "2021-02-23T12:00:00.000Z", attendees: ["Alex Example"], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [], motions: [],
    sections: [{ title: "Budget", discussion: "Carry-forward reviewed.\\\nBudget approved \\| see notes", actionItems: [{ text: "Send feedback", assignee: "Alex Example", done: false }] }],
  } as any,
  styleId: "executive-agenda",
  options: { sourceFidelity: false },
} as any);
assert.doesNotMatch(html, /\\\|/, "no escaped pipes in the export");
assert.match(html, /<li>Carry-forward reviewed\.<\/li>\s*<li>Budget approved \| see notes<\/li>/, "executive style: one bullet per written line");
assert.match(html, /Alex Example to Send feedback/);
console.log("✓ exports: escapes removed, one bullet per line, actions with owners");

// ---------- numbered style: roles, structured next meetings -------------------
const numbered = renderMinutesHtml({
  society: { name: "Retest Society" } as any,
  meeting: { title: "Executive meeting", scheduledAt: "2012-05-15T12:00:00.000Z", scheduledAtPrecision: "date", type: "Committee", agendaItems: ["Welcome"] } as any,
  minutes: {
    heldAt: "2012-05-15T12:00:00.000Z", attendees: ["Alex Example", "Blair Sample"], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [], motions: [],
    detailedAttendance: [{ name: "Alex Example", status: "present", roleTitle: "President" }, { name: "Blair Sample", status: "present" }],
    nextMeetings: [
      { at: "2012-05-29", dateText: "May 29 (5:30-7:30 PM)", bodyLabel: "Board", notes: "Discuss draft work plan" },
      { dateText: "Second Tuesday of the month", bodyLabel: "Executive Committee" },
    ],
    sections: [{ title: "Welcome", discussion: "Opened." }],
  } as any,
  styleId: "numbered-agenda",
  options: { sourceFidelity: false },
} as any);
assert.match(numbered, /Alex Example \(President\), Blair Sample/, "present line carries roles from the attendance grid");
assert.match(numbered, /Next Meetings/);
assert.match(numbered, /\(May 29 \(5:30-7:30 PM\)\) · Board — Discuss draft work plan/);
assert.match(numbered, /Second Tuesday of the month · Executive Committee/);
console.log("✓ numbered style: attendee roles and every structured next meeting");

// ---------- export dates in the meeting's zone ---------------------------------
const evening = renderMinutesHtml({
  society: { name: "Retest Society" } as any,
  meeting: { title: "Board meeting", scheduledAt: "2021-02-24T01:00:00.000Z", scheduledAtPrecision: "datetime", timeZone: "America/Vancouver", type: "Board" } as any,
  minutes: { heldAt: "2021-02-24T01:00:00.000Z", attendees: ["Alex Example"], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [], motions: [], sections: [{ title: "Welcome", discussion: "Opened." }] } as any,
  styleId: "numbered-agenda",
  options: { sourceFidelity: false },
} as any);
assert.match(evening, /Tuesday, February 23, 2021/, "a 5 PM Pacific meeting is not dated the next (UTC) day");
assert.match(evening, /5:00/);
console.log("✓ exports: dates and times in the meeting's time zone");

const labelled = (approvedAt: string | null) => renderMinutesHtml({
  society: { name: "Retest Society" } as any,
  meeting: { title: "Board meeting", scheduledAt: "2021-02-23T12:00:00.000Z", type: "Board" } as any,
  minutes: { approvedAt, heldAt: "2021-02-23T12:00:00.000Z", attendees: ["Alex Example"], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [], motions: [],
    sections: [{ title: "Budget", decisions: ["Reported decision (source review pending): ● 2021 draft budget approved."] }] } as any,
  styleId: "numbered-agenda",
  options: { sourceFidelity: false },
} as any);
assert.match(labelled(null), /Reported decision \(source review pending\)/, "unreviewed drafts keep the review label");
assert.doesNotMatch(labelled("2021-05-18"), /source review pending|●/, "adopted minutes print the decision only");
assert.match(labelled("2021-05-18"), /2021 draft budget approved\./);
console.log("✓ exports: review-pending labels dropped once adopted");

// ---------- reviewed imports are not blocked on details the source never recorded
assert.deepEqual(formalMinutesExportBlockers({
  meeting: { status: "Held", sourceReviewStatus: "source_reviewed" },
  minutes: { approvedAt: "2021-05-18", attendees: ["Alex Example"], sections: [{ title: "Budget" }], chairName: "Alex Example", quorumStatus: "not_recorded" },
  agendaItemCount: 1,
  motions: [{ text: "To approve the budget", outcome: "Carried" }],
}), []);
assert.ok(formalMinutesExportBlockers({
  meeting: { status: "Held" },
  minutes: { approvedAt: "2021-05-18", attendees: ["Alex Example"], sections: [{ title: "Budget" }], chairName: "Alex Example" },
  agendaItemCount: 1,
  motions: [{ text: "To approve the budget", outcome: "Carried" }],
}).some((line) => /mover/.test(line)), "native minutes still need mover/seconder/tally");
console.log("✓ formal export: reviewed imports export as recorded; native minutes keep completeness checks");

// ---------- export default after review / approval ----------------------------
assert.equal(effectiveSourceFidelity(true, undefined, { sourceReviewStatus: "imported_needs_review" }), true, "unreviewed imports export the source record");
assert.equal(effectiveSourceFidelity(true, undefined, { approvedAt: "2012-05-29" }), false, "approved minutes export the corrected minutes");
assert.equal(effectiveSourceFidelity(true, undefined, {}, { sourceReviewStatus: "source_reviewed" }), false, "reviewed meetings export the corrected minutes");
assert.equal(effectiveSourceFidelity(false, true, { approvedAt: "2012-05-29" }), true, "an explicit choice wins");
console.log("✓ export default: corrected minutes once reviewed or approved");

// ---------- agenda edits keep section content on rename / reorder --------------
{
  const existing = [
    { title: "Welcome", agendaItemId: "ai1", discussion: "" },
    { title: "Agenda: Review and", agendaItemId: "ai2", discussion: "Agenda approved." },
    { title: "Budget", agendaItemId: "ai3", discussion: "Budget approved." },
    { title: "Old item", agendaItemId: "ai4", discussion: "Kept because it has notes." },
  ];
  const motionRows = [
    { text: "Approve the agenda", sectionIndex: 1, sectionTitle: "Agenda: Review and" },
    { text: "Approve the budget", sectionIndex: 2, sectionTitle: "Budget" },
  ];
  const result = alignSectionsToAgenda(existing, [
    { title: "Agenda: Review and Approval", depth: 0, _id: "ai2" },
    { title: "Welcome", depth: 0, _id: "ai1" },
    { title: "Budget", depth: 0 },
    { title: "Upcoming meetings", depth: 0 },
  ], motionRows, (title, depth) => ({ title, depth, agendaItemId: undefined as any, discussion: "" }), (section) => !!section.discussion);
  assert.deepEqual(result.sections.map((section) => section.title), ["Agenda: Review and Approval", "Welcome", "Budget", "Upcoming meetings", "Old item"]);
  assert.equal(result.sections[0].discussion, "Agenda approved.", "renamed item keeps its notes");
  assert.deepEqual(result.motions.map((motion) => [motion.sectionIndex, motion.sectionTitle]), [[0, "Agenda: Review and Approval"], [2, "Budget"]]);
  assert.equal(result.sectionsChanged, true);
}
console.log("✓ agenda editor: renamed and reordered items keep their notes and motions");

// ---------- tidy imported action items -----------------------------------------
{
  const rows = [
    { sectionIndex: 1, actionIndex: 0, text: "Reported action (source review pending): ACTION: Office to explore opportunities for" },
    { sectionIndex: 2, actionIndex: 0, text: "Reported action (source review pending): ACTION: Office to explore opportunities for training." },
    { sectionIndex: 2, actionIndex: 1, text: "ACTION: Alex Example to revise the plan." },
    { sectionIndex: 3, actionIndex: 0, text: "ACTION: Alex Example to revise the plan." },
    { sectionIndex: 3, actionIndex: 1, text: "Send it" },
  ];
  assert.deepEqual(duplicateActionRows(rows).map((row) => [row.sectionIndex, row.actionIndex]), [[1, 0], [3, 0]]);
  assert.equal(plainActionWording(rows[1].text), "Office to explore opportunities for training.");
  assert.equal(suggestedActionOwner(rows[2].text), "Alex Example");
  assert.equal(suggestedActionOwner("Send it"), undefined);
}
console.log("✓ action tidy: cut-off duplicates, import labels and named owners");

// ---------- governance retest items O-5..O-7 ----------------------------------
const defaultStart = defaultNewMeetingStart(14, new Date(2026, 9, 7, 4, 16));
assert.equal(defaultStart.getHours(), 18);
assert.equal(defaultStart.getMinutes(), 0);
assert.equal(defaultStart.getDate(), 21);
assert.equal(meetingCreateLabels("2020-01-01T18:00").action, "Record meeting");
assert.equal(meetingCreateLabels("2099-01-01T18:00").action, "Schedule");
assert.deepEqual(minutesApprovalIssues({ approvedOn: "2026-10-06", meeting: { scheduledAt: "2026-09-01T12:00:00.000Z" }, today: "2026-10-06" }), []);
assert.equal(upcomingMeetingsFromISO("2026-10-07T03:00:00.000Z", "2026-10-06"), "2026-10-06T00:00:00.000Z", "a BC evening keeps today's date-only meetings");
assert.equal(upcomingMeetingsFromISO("2026-10-06T22:00:00.000Z", "2026-10-07"), "2026-10-06T22:00:00.000Z", "east of UTC keeps the current instant");
console.log("✓ new meeting default 6 PM, Record vs Schedule, local-day approval and upcoming bounds");

assert.equal(pastNoticeDateValue("2019-05-01", "2019-05-28T12:00:00.000Z").error, undefined);
assert.equal(new Date(pastNoticeDateValue("2019-05-01", "2019-05-28").iso!).getDate(), 1, "stored at local noon so the day cannot shift");
assert.match(String(pastNoticeDateValue("2019-06-01", "2019-05-28").error), /on or before/);
assert.match(String(pastNoticeDateValue("2019-02-30", "2019-05-28").error), /real calendar date/);
assert.match(String(pastNoticeDateValue("May 1", "2019-05-28").error), /YYYY-MM-DD/);
console.log("✓ past meetings: notice is recorded with its real date, never 'sent today'");

const candidates = approvingMeetingCandidates(
  { _id: "agm19", type: "AGM", scheduledAt: "2019-05-28T12:00:00.000Z" },
  [
    { _id: "b1", type: "Board", scheduledAt: "2019-09-17T12:00:00.000Z" },
    { _id: "agm20", type: "AGM", scheduledAt: "2020-06-23T12:00:00.000Z" },
    { _id: "old", type: "AGM", scheduledAt: "2018-11-28T12:00:00.000Z" },
  ],
);
assert.deepEqual(candidates.map((row) => row._id), ["agm20", "b1"], "the next AGM is offered first for AGM minutes");

const withStaff = renderMinutesHtml({
  society: { name: "Retest Society" } as any,
  meeting: { title: "Board meeting", scheduledAt: "2021-02-23T12:00:00.000Z", type: "Board" } as any,
  minutes: { heldAt: "2021-02-23T12:00:00.000Z", attendees: ["Alex Example", "Casey Demo"], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [], motions: [],
    detailedAttendance: [{ name: "Alex Example", status: "present" }, { name: "Casey Demo", status: "staff", roleTitle: "Note-taker" }],
    sections: [{ title: "Welcome", discussion: "Opened." }] } as any,
  styleId: "numbered-agenda",
  options: { sourceFidelity: false },
} as any);
assert.match(withStaff, /<strong>Present:<\/strong> Alex Example<\/p>/);
assert.match(withStaff, /<strong>Also present:<\/strong> Casey Demo \(Note-taker\)/);
console.log("✓ approval candidates by body; staff listed as also present");

assert.equal(preferredMeetingToKeep([
  { _id: "draft", sourceTitle: "2021_10_12_Ops_DRAFT Minutes.docx" },
  { _id: "approved", sourceTitle: "2021_10_12_Ops_APPROVED Minutes.pdf" },
], () => ({ sectionCount: 7 }))?._id, "approved", "the approved copy is kept by default");
assert.equal(preferredMeetingToKeep([
  { _id: "a", title: "Board meeting" },
  { _id: "b", title: "Board meeting" },
], (row) => (row._id === "b" ? { approvedAt: "2021-01-01" } : {}))?._id, "b");
console.log("✓ merge: approved / final copy kept by default");

// ---------- X-01: meetings known only from an agenda ---------------------------
assert.equal(agendaOnlyMeetingStatus("2019-05-01", "2026-10-07"), "HeldMinutesMissing");
assert.equal(agendaOnlyMeetingStatus("2026-10-07", "2026-10-07"), "Scheduled", "an agenda for today is not yet held");
assert.equal(agendaOnlyMeetingStatus("2027-01-12", "2026-10-07"), "Scheduled");
{
  const sid = "x01_society";
  const agendaClient = new StaticConvexClient({ seed: {
    societies: [{ _id: sid, name: "Agenda Society", jurisdictionCode: "CA-BC", entityType: "society" }],
    meetings: [
      { _id: "past_draft", societyId: sid, type: "Board", title: "Board meeting", scheduledAt: "2019-05-01", scheduledAtPrecision: "date", electronic: false, status: "Draft", attendeeIds: [] },
      { _id: "future_held", societyId: sid, type: "Board", title: "Board meeting", scheduledAt: "2099-05-01", scheduledAtPrecision: "date", electronic: false, status: "Held", attendeeIds: [] },
      { _id: "reviewed", societyId: sid, type: "Board", title: "Board meeting", scheduledAt: "2018-05-01", scheduledAtPrecision: "date", electronic: false, status: "Held", sourceReviewStatus: "source_reviewed", attendeeIds: [] },
      { _id: "real_minutes", societyId: sid, type: "Board", title: "Board meeting", scheduledAt: "2017-05-01", scheduledAtPrecision: "date", electronic: false, status: "Held", attendeeIds: [] },
    ],
    minutes: [
      { _id: "min_past", societyId: sid, meetingId: "past_draft", heldAt: "2019-05-01", attendees: [], absent: [], quorumMet: false, discussion: "", decisions: [], actionItems: [], sourceTransposition: { version: 1, sourceKind: "agenda" } },
      { _id: "min_future", societyId: sid, meetingId: "future_held", heldAt: "2099-05-01", attendees: [], absent: [], quorumMet: false, discussion: "No minutes were found for this meeting. It is evidenced by agenda.pdf (agenda).", decisions: [], actionItems: [] },
      { _id: "min_reviewed", societyId: sid, meetingId: "reviewed", heldAt: "2018-05-01", attendees: [], absent: [], quorumMet: false, discussion: "", decisions: [], actionItems: [], sourceTransposition: { version: 1, sourceKind: "agenda" } },
      { _id: "min_real", societyId: sid, meetingId: "real_minutes", heldAt: "2017-05-01", attendees: [], absent: [], quorumMet: false, discussion: "Called to order.", decisions: [], actionItems: [], sourceTransposition: { version: 1, sourceKind: "recorded_minutes" } },
    ],
  } });
  await agendaClient.whenLocalWorkspaceReady();
  const report: any = await agendaClient.mutation("minutes:repairImported", { societyId: sid });
  const statusOf = (id: string) => (agendaClient.exportLocalWorkspaceSnapshot().tables as Record<string, any[]>).meetings.find((row) => row._id === id).status;
  assert.equal(report.agendaOnlyStatusesFixed, 2);
  assert.equal(statusOf("past_draft"), "HeldMinutesMissing", "a past agenda-only meeting is held, minutes missing");
  assert.equal(statusOf("future_held"), "Scheduled", "an agenda-only meeting still ahead is scheduled");
  assert.equal(statusOf("reviewed"), "Held", "a reviewer's status is kept");
  assert.equal(statusOf("real_minutes"), "Held", "meetings with recorded minutes are untouched");
}
console.log("✓ agenda-only meetings: Held — minutes missing when past, Scheduled otherwise");

// ---------- new meeting title: suggested from body and date, follows the date --
assert.equal(suggestedMeetingTitle({ type: "Board", scheduledAt: "2026-10-22T18:00" }), "Board meeting — 2026-10-22");
assert.equal(suggestedMeetingTitle({ type: "Committee", committeeId: "c1", scheduledAt: "2026-11-03T18:00" }, [{ _id: "c1", name: "Finance Committee" }]), "Finance Committee meeting — 2026-11-03");
assert.equal(suggestedMeetingTitle({ type: "Board", scheduledAt: "" }), "", "no date, no suggestion");
assert.equal(titleForChangedDate("Board meeting — 2026-10-22", "2026-10-22", "2026-10-06"), "Board meeting — 2026-10-06");
assert.equal(titleForChangedDate("Fall planning session", "2026-10-22", "2026-10-06"), "Fall planning session", "a typed title is kept");
console.log("✓ new meetings: blank title uses the body and date; dated titles follow a date change");

// ---------- minutes details: officers from attendance roles ---------------------
assert.deepEqual(officerNamesFromAttendance([
  { name: "Alex Example", roleTitle: "Chair", status: "present" },
  { name: "Blair Sample", roleTitle: "Secretary", status: "present" },
  { name: "Casey Demo", roleTitle: "Minute-taker", status: "staff" },
  { name: "Drew Placeholder", roleTitle: "Treasurer", status: "regrets" },
], { chairName: "", secretaryName: "Kept Name", recorderName: "" }), { chairName: "Alex Example", recorderName: "Casey Demo" });
assert.deepEqual(officerNamesFromAttendance([
  { name: "Alex Example", roleTitle: "Chair", status: "regrets" },
], {}), {}, "absent people are not suggested");
console.log("✓ minutes details: empty chair/secretary/recorder start from attendance roles");

// ---------- numbered export of a meeting recorded from scratch ------------------
const fromScratch = renderMinutesHtml({
  society: { name: "Retest Society" } as any,
  meeting: { title: "Board meeting — 2026-10-06", scheduledAt: "2026-10-07T01:00:00.000Z", type: "Board" } as any,
  minutes: {
    heldAt: "2026-10-07T01:00:00.000Z", attendees: ["Alex Example", "Blair Sample", "Casey Demo"], absent: [], quorumMet: true, quorumRequired: 2,
    discussion: "", decisions: [], actionItems: [], adjournedAt: "7:41 PM",
    detailedAttendance: [{ name: "Alex Example", status: "present" }, { name: "Blair Sample", status: "present" }, { name: "Casey Demo", status: "staff" }],
    motions: [
      { text: "BE IT RESOLVED THAT the agenda for this meeting be adopted as presented.", outcome: "Carried", sectionIndex: 0, sectionTitle: "Adopt agenda" },
      { text: "BE IT RESOLVED THAT the meeting be adjourned.", outcome: "Carried", resolutionType: "Procedural", sectionIndex: 1, sectionTitle: "Adjournment" },
    ],
    sections: [
      { title: "Adopt agenda", motionText: "BE IT RESOLVED THAT the agenda for this meeting be adopted as presented." },
      { title: "Adjournment", motionText: "BE IT RESOLVED THAT the meeting be adjourned." },
    ],
  } as any,
  styleId: "numbered-agenda",
  options: { sourceFidelity: false },
} as any);
assert.match(fromScratch, /\(2 present \/ 2 required\)/, "staff are not counted toward quorum in the export");
assert.doesNotMatch(fromScratch, /Motion wording:/, "template motion wording already shown as a motion is not repeated after the signatures");
assert.equal((fromScratch.match(/>\s*(?:\d+\.\s*)?Adjournment\s*</g) ?? []).length, 1, "one Adjournment heading: the agenda item carries the adjournment record");
assert.match(fromScratch, /The meeting was adjourned at 7:41 PM/);
assert.match(fromScratch, /<strong>Motion:<\/strong> That the agenda for this meeting be adopted as presented\./, "the trimmed resolution reads as a sentence");
const notedAdjournment = renderMinutesHtml({
  society: { name: "Retest Society" } as any,
  meeting: { title: "Executive meeting", scheduledAt: "2012-05-15T12:00:00.000Z", scheduledAtPrecision: "date", type: "Board" } as any,
  minutes: { heldAt: "2012-05-15T12:00:00.000Z", attendees: [], absent: [], quorumMet: false, discussion: "", decisions: [], actionItems: [], motions: [], adjournedAt: "4:00 PM",
    sections: [{ title: "Welcome" }, { title: "Adjournment", discussion: "Meeting is adjourned at 4:00 PM" }] } as any,
  styleId: "numbered-agenda",
  options: { sourceFidelity: false },
} as any);
assert.doesNotMatch(notedAdjournment, /The meeting was adjourned at/, "notes that already record the adjournment are not echoed");
console.log("✓ numbered export: quorum counts members only; no repeated motion wording or second Adjournment heading");

// ---------- the first templated meeting has no "previous meeting date" filler ----
{
  const sid = "first_meeting_society";
  const first = new StaticConvexClient({ seed: { societies: [{ _id: sid, name: "First Meeting Society", jurisdictionCode: "CA-BC", entityType: "society" }] } });
  await first.whenLocalWorkspaceReady();
  await first.mutation("meetingTemplates:seedDefaults", { societyId: sid });
  const templates = await first.query("meetingTemplates:list", { societyId: sid }) as any[];
  const board = templates.find((row) => row.isDefault) ?? templates[0];
  await first.mutation("meetings:create", { societyId: sid, type: "Board", title: "Board meeting — 2026-10-06", scheduledAt: "2026-10-06T18:00", electronic: false, status: "Held", attendeeIds: [], meetingTemplateId: board._id });
  const rows = (first.exportLocalWorkspaceSnapshot().tables as Record<string, any[]>);
  const wording = JSON.stringify([rows.motions?.map((row) => row.text), rows.agendaItems?.map((row) => [row.title, row.motionTemplate, row.details])]);
  assert.doesNotMatch(wording, /previous meeting date/, "no placeholder date when there is no earlier meeting");
  assert.match(wording, /minutes of the previous meeting, as (?:circulated|presented)/);
}
console.log("✓ templates: the first meeting's adoption motion reads \"the minutes of the previous meeting\"");
