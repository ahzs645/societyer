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
import { defaultNewMeetingStart, meetingCreateLabels } from "../src/features/meetings/lib/noticeWindow";
import { minutesApprovalIssues } from "../shared/meetingApproval";
import { upcomingMeetingsFromISO } from "../shared/functions/dashboard";
import { alignSectionsToAgenda } from "../src/features/meetings/lib/agendaSectionAlign";

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
