// Retest gate (meetings area): fixes found while correcting imported minutes
// end to end. Synthetic names only; runs the real portable handlers on the
// local StaticConvexClient — no live backend.
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { minutesTextForDisplay } from "../shared/minutesMarkdownText";
import { clockTextTo24h } from "../shared/meetingDateEdit";
import { blankAttendanceRow, mergeAttendanceRows } from "../shared/meetingAttendanceGrid";
import { renderMinutesHtml } from "../src/features/meetings/lib/minutesRenderer";

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
