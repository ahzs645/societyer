// The meeting notes surface's pure parts: the Meetings timeline grouping,
// the Markdown export and recap, the Ask bar's meeting context, and
// the recorder's file naming.
//
//   node --import tsx scripts/check-meeting-notes-surface.ts
import assert from "node:assert/strict";
import { dayLabel, groupMeetingsByDay, meetingDay } from "../shared/meetingTimeline";
import {
  meetingAskContextAttachment,
  notesExportFileName,
  notesMeetingMarkdown,
  notesRecapText,
  type NotesExportInput,
} from "../shared/meetingNotesExport";
import { formatElapsed, recordingFileName } from "../src/features/meetings/recorder/meetingRecorder";
import { notesTranscriptLink, transcriptQuoteMarkdown } from "../src/features/meetings/transcript/transcriptQuote";

// ---------- timeline ----------------------------------------------------------------
const now = new Date(2026, 10, 12, 10, 0); // Thursday 12 November 2026, 10:00 local
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString();
const meetings = [
  { _id: "a", title: "Today late", scheduledAt: at(12, 16) },
  { _id: "b", title: "Today early", scheduledAt: at(12, 9) },
  { _id: "c", title: "Tomorrow", scheduledAt: at(13, 9) },
  { _id: "d", title: "Next week", scheduledAt: at(19, 9) },
  { _id: "e", title: "Yesterday", scheduledAt: at(11, 9) },
  { _id: "f", title: "Last week", scheduledAt: at(5, 9) },
  { _id: "g", title: "Date only", scheduledAt: "2026-11-10T12:00:00.000Z", scheduledAtPrecision: "date" },
  { _id: "h", title: "Far future", scheduledAt: at(12 + 45, 9) },
  { _id: "i", title: "Long ago", scheduledAt: new Date(2025, 0, 2, 9).toISOString() },
];
const { groups, hasEarlier, laterCount } = groupMeetingsByDay(meetings, now);
assert.deepEqual(groups.map((group) => [group.label, group.when, group.meetings.map((row) => row._id).join(",")]), [
  ["Tomorrow", "upcoming", "c"],
  [dayLabel("2026-11-19", "2026-11-12"), "upcoming", "d"],
  ["Today", "today", "b,a"],
  ["Yesterday", "past", "e"],
  [dayLabel("2026-11-10", "2026-11-12"), "past", "g"],
  [dayLabel("2026-11-05", "2026-11-12"), "past", "f"],
], "upcoming soonest first, today in time order, then earlier days newest first");
assert.equal(dayLabel("2026-11-19", "2026-11-12"), "Thursday, November 19");
assert.equal(dayLabel("2025-01-02", "2026-11-12"), "Thursday, January 2, 2025", "another year names it");
assert.equal(hasEarlier, true);
assert.equal(laterCount, 1);
assert.equal(meetingDay({ scheduledAt: "2026-11-10T12:00:00.000Z", scheduledAtPrecision: "date" }), "2026-11-10", "a date-only meeting keeps its date");
assert.equal(groupMeetingsByDay(meetings, now, { pastDays: 1000 }).hasEarlier, false);
console.log("✓ timeline: coming up, today, earlier days; date-only meetings; later and earlier counts");

// ---------- export and recap -----------------------------------------------------------
const input: NotesExportInput = {
  meeting: { title: "Partner call / Example", scheduledAt: "2026-11-12T17:00:00.000Z", location: "Online", attendeeIds: ["Sam Rivera", "Priya Raman"] },
  notes: "# Raw\n- Foundation wants a pilot",
  draft: {
    template: "external_call",
    summary: "They'll fund a pilot.",
    sections: [{ heading: "Context", points: ["Example Foundation"] }],
    decisions: ["Apply for the pilot"],
    openQuestions: ["Who signs?"],
  },
  actionItems: [
    { text: "Send the budget", assignee: "Sam Rivera", dueDate: "2026-11-20" },
    { text: "Book a room", done: true },
  ],
  transcript: "[0:00] Sam: Hello\n[0:05] Priya: Hi",
};
const withQuotes = notesMeetingMarkdown({ ...input, draft: { ...input.draft!, quotes: [{ text: "We'd like to fund a pilot.", speaker: "Dana Lee", atSec: 9 }, { text: "No speaker" }] } });
assert.match(withQuotes, /### Key quotes\n\n> “We'd like to fund a pilot\.” — Dana Lee, 0:09\n\n> “No speaker”/, "key quotes in the export");
const markdown = notesMeetingMarkdown(input);
assert.ok(markdown.startsWith("# Partner call / Example\n\n2026-11-12 · Online\n\n**Attendees:** Sam Rivera, Priya Raman"));
assert.match(markdown, /## AI notes \(External call\)\n\n### Summary\n\nThey'll fund a pilot\./);
assert.match(markdown, /## Action items\n\n- \[ \] Send the budget — Sam Rivera \(due 2026-11-20\)\n- \[x\] Book a room/);
assert.match(markdown, /## Notes\n\n## Raw\n- Foundation wants a pilot/, "the person's headings go one level down");
assert.match(markdown, /## Transcript\n\n\[0:00\] Sam: Hello/);
assert.ok(!notesMeetingMarkdown(input, { notes: true, aiNotes: false, actions: false, transcript: false }).includes("Transcript"));
assert.equal(notesExportFileName(input.meeting, "md"), "2026-11-12 Partner call Example.md", "safe file name");
const recap = notesRecapText(input);
assert.equal(recap, [
  "Partner call / Example — 2026-11-12",
  "",
  "They'll fund a pilot.",
  "",
  "Decisions:",
  "• Apply for the pilot",
  "",
  "Next steps:",
  "• Send the budget (Sam Rivera, by 2026-11-20)",
  "",
  "Open questions:",
  "• Who signs?",
].join("\n"), "done actions are left out of next steps");
console.log("✓ export: Markdown sections, safe file names, recap");

// ---------- Ask bar context ------------------------------------------------------------
const small = meetingAskContextAttachment({ ...input, people: ["Sam Rivera — Treasurer"] });
assert.equal(small.name, "2026-11-12 Partner call Example (meeting context).md");
assert.equal(small.mediaType, "text/markdown");
assert.match(small.text, /## People in the organization\n\nSam Rivera — Treasurer/);
assert.match(small.text, /## Transcript\n\n\[0:00\] Sam: Hello\n\[0:05\] Priya: Hi/);
const longTranscript = Array.from({ length: 4000 }, (_, i) => `[${i}:00] Sam: line ${i} ${"word ".repeat(10)}`).join("\n");
const big = meetingAskContextAttachment({ ...input, transcript: longTranscript });
assert.ok(new TextEncoder().encode(big.text).byteLength <= 32 * 1024, "within the attachment limit");
assert.match(big.text, /## Transcript \(first \d+ of 4000 lines\)/, "says the transcript was cut");
assert.match(big.text, /## AI notes/, "the notes come before the transcript");
console.log("✓ Ask bar context: notes first, transcript cut on a line to fit 32 KiB, and says so");

// ---------- recorder naming ------------------------------------------------------------
assert.equal(recordingFileName("Partner call: Q4/Budget", new Date(2026, 10, 12, 14, 5).getTime(), "webm"), "Partner call Q4 Budget 2026-11-12 14-05.webm");
assert.equal(recordingFileName("", new Date(2026, 0, 2, 9, 0).getTime(), "m4a"), "Meeting 2026-01-02 09-00.m4a");
assert.equal(formatElapsed(65), "1:05");
assert.equal(formatElapsed(3725), "1:02:05");
console.log("✓ recorder: safe file names and elapsed time");

// ---------- quote in notes -------------------------------------------------------------
const quoteHref = notesTranscriptLink(54, 61.5, { pathname: "/app/meetings/m1", search: "?tab=notes&view=transcript" });
assert.equal(quoteHref, "/app/meetings/m1?tab=transcript&t=54-61.5", "a legacy notes query produces the current Transcript URL");
assert.equal(
  notesTranscriptLink(3, 4, { pathname: "/app/meetings/m1", search: "?tab=transcript&t=1-2" }),
  "/app/meetings/m1?tab=transcript&t=3-4",
  "on the Transcript tab the link updates the selected time range",
);
assert.equal(
  transcriptQuoteMarkdown({ text: "  \"Small pilots are\n where we learn.\" ", speaker: "Priya Raman", start: 54, end: 61.5 }, quoteHref),
  `> “Small pilots are where we learn.”\n>\n> — Priya Raman, [0:54](${quoteHref})`,
  "one line of words, existing quote marks dropped, then who and when",
);
assert.match(transcriptQuoteMarkdown({ text: "Hi", speaker: " ", start: 0, end: 1 }, "x"), /— Unknown speaker, \[0:00\]\(x\)$/);
assert.equal(
  transcriptQuoteMarkdown({ text: "Can we? Yes we can.", speaker: "Sam", parts: [{ speaker: "Sam", text: "Can we?" }, { speaker: "Priya", text: "Yes we can." }], start: 3, end: 8 }, "x"),
  "> **Sam:** “Can we?”\n>\n> **Priya:** “Yes we can.”\n>\n> — [0:03](x)",
  "a selection across speakers credits each one",
);
console.log("✓ quote in notes: blockquote with speaker and a link back to that moment; each speaker credited");
