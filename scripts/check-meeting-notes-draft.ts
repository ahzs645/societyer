// Meeting notes: the AI notes draft (shared/ai/notesDraft.ts), notes action
// items (shared/meetingNoteActions.ts) and their portable mutations in the
// local runtime, including "Create task" and "Turn notes into minutes".
//
//   node --import tsx scripts/check-meeting-notes-draft.ts
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { StaticConvexClient } from "../src/lib/staticConvex";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { PORTABLE_TEST_AUTH_SUBJECT } from "./portable-test-fixture";
import {
  buildNotesDraftMessages,
  heuristicNotesDraft,
  mergeNotesDrafts,
  normalizeNotesDraft,
  NOTES_DRAFT_TEMPLATES,
  notesDraftMarkdown,
  notesDraftTemplate,
  notesDraftTranscript,
  notesDraftTranscriptFromRow,
  parseNotesDraft,
  planNotesDraftRequests,
  type NotesDraft,
  type NotesDraftInput,
} from "../shared/ai/notesDraft";
import {
  isReplaceableSuggestion,
  mergeSuggestedActions,
  minutesActionItemsFromNotes,
  normalizeNoteActionItems,
  taskDraftFromNoteAction,
  type NoteActionItem,
} from "../shared/meetingNoteActions";
import { draftNotesOnDevice } from "../src/features/meetings/localNotesDraft";

// ---------- templates and prompt -------------------------------------------------
assert.deepEqual(NOTES_DRAFT_TEMPLATES.map((template) => template.id), ["general", "one_on_one", "check_in", "external_call"]);
assert.equal(notesDraftTemplate("nonsense").id, "general", "unknown templates fall back to general");

const transcript = notesDraftTranscript(
  [
    { speaker: "SPEAKER_00", text: "Welcome.", startSec: 0 },
    { speaker: "SPEAKER_01", text: "Action item: Priya to send the budget by 2026-04-01.", startSec: 125.4 },
    { speaker: "SPEAKER_00", text: "Decision recorded: we renew the lease.", startSec: 3725 },
  ],
  (label) => (label === "SPEAKER_00" ? "Alex" : "Priya"),
);
assert.equal(transcript.split("\n")[1], "[2:05] Priya: Action item: Priya to send the budget by 2026-04-01.");
assert.equal(transcript.split("\n")[2].slice(0, 10), "[1:02:05] ", "hours appear once a meeting passes an hour");
assert.equal(
  notesDraftTranscriptFromRow({ segments: [{ speaker: "S1", text: "Hi.", startSec: 3 }], speakers: [{ label: "S1", name: "Jo" }] }),
  "[0:03] Jo: Hi.",
  "speaker names from the speaker map",
);
assert.equal(notesDraftTranscriptFromRow({ segments: [], text: "Plain text." }), "Plain text.");
assert.equal(notesDraftTranscriptFromRow(null), "");

const input: NotesDraftInput = {
  meetingTitle: "Staff check-in",
  meetingDate: "2026-03-03",
  template: "check_in",
  notes: "# Grants\n- Funder call went well\n- [ ] Sam to draft the report\n- We agreed to apply in June\n- Who signs the MOU?\n\nTODO: book the hall",
  transcript,
  attendees: ["Alex", "Priya"],
};
const [system, user] = buildNotesDraftMessages(input);
assert.equal(system.role, "system");
assert.match(system.content, /never contradict them/);
assert.match(user.content, /Template: Check-in \/ stand-up/);
assert.match(user.content, /Note-taker's notes:\n# Grants/);
assert.match(user.content, /Transcript:\n\[0:00\] Alex: Welcome\./);
assert.match(user.content, /Attendees: Alex, Priya/);

// ---------- rule-based draft -----------------------------------------------------
const heuristic = heuristicNotesDraft(input);
assert.equal(heuristic.template, "check_in");
assert.deepEqual(heuristic.sections.map((section) => section.heading), ["Grants"]);
assert.deepEqual(heuristic.decisions, ["We agreed to apply in June", "we renew the lease."]);
assert.deepEqual(heuristic.openQuestions, ["Who signs the MOU?"]);
assert.deepEqual(
  heuristic.actionItems.map((item) => [item.text, item.assignee, item.dueDate, item.atSec]),
  [
    ["Sam to draft the report", "Sam", undefined, undefined],
    ["book the hall", undefined, undefined, undefined],
    ["Priya to send the budget by 2026-04-01", "Priya", "2026-04-01", 125],
  ],
  "checkboxes, TODO lines and transcript action items, with the transcript time",
);
assert.equal(heuristicNotesDraft({ ...input, notes: "", transcript: "" }).summary, "Notes from Staff check-in.");

// ---------- untrusted replies ----------------------------------------------------
const fallback: NotesDraft = { template: "general", summary: "Fallback.", sections: [], decisions: [], openQuestions: [], actionItems: [] };
assert.deepEqual(parseNotesDraft("not json at all", fallback), fallback, "prose falls back");
const parsed = parseNotesDraft(
  "```json\n" + JSON.stringify({
    summary: "  We met.  ",
    sections: [{ heading: "Updates", points: ["- A", "A", "", 7, "B"] }, { heading: "", points: ["x"] }, { heading: "Empty", points: [] }],
    decisions: ["Renew", "renew!"],
    openQuestions: "not a list",
    actionItems: [
      { text: "Sam to call", assignee: "Sam", dueDate: "2026-02-30", atSec: 61.26 },
      { text: "sam to call." },
      { text: "Bad time", atSec: -1 },
      "Plain string action",
      { text: "" },
    ],
  }) + "\n```",
  fallback,
);
assert.equal(parsed.summary, "We met.");
assert.deepEqual(parsed.sections, [{ heading: "Updates", points: ["A", "B"] }], "bullets stripped, duplicates and empty sections dropped");
assert.deepEqual(parsed.decisions, ["Renew"], "near-duplicates dropped");
assert.deepEqual(parsed.openQuestions, [], "a wrong type falls back");
assert.deepEqual(parsed.actionItems, [
  { text: "Sam to call", assignee: "Sam", atSec: 61.3 },
  { text: "Bad time" },
  { text: "Plain string action" },
], "invalid dates and times dropped, duplicates merged");
const long = normalizeNotesDraft({ summary: "x".repeat(10_000), sections: [], decisions: [], openQuestions: [], actionItems: [] }, fallback);
assert.equal(long.summary.length, 4_000, "summary bounded");

// ---------- long transcripts -----------------------------------------------------
const longTranscript = Array.from({ length: 400 }, (_, i) => `[${i}:00] Alex: Line ${i} ${"word ".repeat(30)}`).join("\n");
const plan = planNotesDraftRequests({ ...input, transcript: longTranscript }, 20_000);
assert.ok(plan.chunked && plan.requests.length > 1, "long transcripts split");
for (const request of plan.requests) {
  assert.match(request.messages[1].content, /# Grants/, "every part carries the notes");
  assert.ok(request.messages[1].content.length < 26_000);
}
assert.match(plan.requests[1].messages[1].content, /\(Part 2 of \d+ of the transcript\.\)/);
assert.equal(planNotesDraftRequests(input, 120_000).requests.length, 1);
const merged = mergeNotesDrafts([
  { ...fallback, summary: "One.", sections: [{ heading: "Updates", points: ["A"] }], actionItems: [{ text: "Call Jo" }] },
  { ...fallback, summary: "Two.", sections: [{ heading: "updates", points: ["A", "B"] }, { heading: "Risks", points: ["C"] }], actionItems: [{ text: "call jo" }, { text: "Email Sam" }] },
]);
assert.equal(merged.summary, "One. Two.");
assert.deepEqual(merged.sections, [{ heading: "Updates", points: ["A", "B"] }, { heading: "Risks", points: ["C"] }]);
assert.deepEqual(merged.actionItems.map((item) => item.text), ["Call Jo", "Email Sam"]);

assert.equal(
  notesDraftMarkdown({ summary: "S.", sections: [{ heading: "H", points: ["p"] }], decisions: ["d"], openQuestions: ["q?"], actionItems: [{ text: "a", dueDate: "2026-04-01" }] }),
  "## Summary\n\nS.\n\n## H\n\n- p\n\n## Decisions\n\n- d\n\n## Action items\n\n- [ ] a (due 2026-04-01)\n\n## Open questions\n\n- q?",
);
console.log("✓ notes draft: templates, prompt, transcript lines, rule-based draft, untrusted replies, parts, Markdown");

// ---------- on-device drafting ---------------------------------------------------
const requests: unknown[] = [];
const device = await draftNotesOnDevice({
  client: {
    completeJson: async (request: { messages: unknown }) => {
      requests.push(request.messages);
      return { text: JSON.stringify({ summary: `Part ${requests.length}.`, sections: [], decisions: [], openQuestions: [], actionItems: [{ text: `Do ${requests.length}` }] }), jsonMode: "json_schema" as const };
    },
  } as never,
  draft: { ...input, transcript: longTranscript },
  chunkChars: 20_000,
});
assert.equal(device.requests, plan.requests.length);
assert.equal(device.draft.actionItems.length, plan.requests.length, "each part's actions merged");
await assert.rejects(
  () => draftNotesOnDevice({ client: { completeJson: async () => ({ text: "{}", jsonMode: "none" }) } as never, draft: { ...input, notes: " ", transcript: "" }, chunkChars: 20_000 }),
  /Write some notes or add a transcript/,
);
console.log("✓ on-device drafting: one request per part, merged");

// ---------- action item helpers --------------------------------------------------
let n = 0;
const makeId = () => `id${++n}`;
const first = mergeSuggestedActions([], [{ text: "Sam to call", atSec: 61 }, { text: "Book hall", dueDate: "2026-04-01" }], makeId);
assert.equal(first.added, 2);
assert.deepEqual(first.items[0], { id: "id1", text: "Sam to call", transcriptRef: { startSec: 61, endSec: 76 }, done: false, status: "open", origin: "ai" });
const edited = first.items.map((item) => (item.id === "id1" ? { ...item, origin: "manual" as const } : item));
const second = mergeSuggestedActions(edited, [{ text: "sam to call" }, { text: "Email Jo" }], makeId);
assert.deepEqual(second.items.map((item) => item.text), ["Sam to call", "Email Jo"], "an edited item stays; untouched suggestions are replaced; repeats dropped");
assert.equal(isReplaceableSuggestion({ ...first.items[1], taskId: "t1" }), false, "an item with a task is kept");
assert.equal(isReplaceableSuggestion({ ...first.items[1], status: "completed", done: true }), false, "a ticked-off item is kept");
assert.throws(() => normalizeNoteActionItems([{ id: "a", text: "x", done: false }, { id: "a", text: "y", done: false }]), /own id/);
assert.throws(() => normalizeNoteActionItems([{ id: "a", text: " ", done: false }]), /needs text/);
assert.throws(() => normalizeNoteActionItems([{ id: "a", text: "x", done: false, dueDate: "Friday" }]), /YYYY-MM-DD/);
assert.throws(() => normalizeNoteActionItems([{ id: "a", text: "x", done: false, transcriptRef: { startSec: 5, endSec: 1 } }]), /Transcript times/);
assert.deepEqual(normalizeNoteActionItems([{ id: "a", text: "  Call   Jo ", done: true }]), [{ id: "a", text: "Call Jo", done: true, status: "completed" }]);
const taskDraft = taskDraftFromNoteAction(
  { id: "a", text: "Sam to call", assignee: "Sam", dueDate: "2026-04-01", done: false, status: "open", goalId: "g1", committeeId: "c1", transcriptRef: { startSec: 1, endSec: 2 } },
  { meetingTitle: "Staff check-in" },
);
assert.equal(taskDraft.description, "From the meeting notes of Staff check-in.");
assert.equal(taskDraft.goalId, "g1");
assert.equal(taskDraft.committeeId, "c1");
assert.deepEqual(taskDraft.transcriptRef, { startSec: 1, endSec: 2 });
assert.deepEqual(minutesActionItemsFromNotes([{ id: "a", text: "x", done: false, goalId: "g", origin: "ai" }]), [{ text: "x", done: false }]);
console.log("✓ action items: suggestions merge, edits survive a redraft, validation, task and minutes shapes");

// ---------- local runtime --------------------------------------------------------
const societyId = "notes_society";
const client = new StaticConvexClient({ seed: {
  societies: [{ _id: societyId, name: "Notes test", jurisdictionCode: "CA-BC", entityType: "society" }],
  meetings: [{ _id: "m_notes", societyId, type: "Working", title: "Staff check-in", scheduledAt: "2026-03-03T16:00:00.000Z", electronic: true, status: "Held", attendeeIds: ["Alex"], recordKind: "notes", workingNotes: "Raw notes stay." }],
  goals: [{ _id: "g_1", societyId, title: "Diversify funding", category: "Funding", status: "Active", startDate: "2026-01-01", targetDate: "2026-12-31", progressPercent: 0, milestones: [], createdAtISO: "2026-01-01T00:00:00.000Z" }],
  committees: [{ _id: "c_1", societyId, name: "Finance Committee", status: "Active", createdAtISO: "2026-01-01T00:00:00.000Z" }],
} });
await client.whenLocalWorkspaceReady();
const tables = () => client.exportLocalWorkspaceSnapshot().tables as Record<string, Array<Record<string, any>>>;
const meeting = () => tables().meetings.find((row) => row._id === "m_notes")!;

const saved = await client.mutation("meetings:saveNotesDraft", {
  id: "m_notes",
  template: "check_in",
  draft: { summary: "We met.", sections: [{ heading: "Plans", points: ["Apply in June"] }], decisions: ["Renew lease"], openQuestions: [], actionItems: [{ text: "Sam to call the funder", atSec: 125 }, { text: "Book the hall" }], extra: "ignored" },
  generatedBy: "On-device: test model",
  usedNotes: true,
  usedTranscript: true,
}) as { actionItemsAdded: number };
assert.equal(saved.actionItemsAdded, 2);
assert.equal(meeting().workingNotes, "Raw notes stay.", "the person's notes are never rewritten");
assert.equal(meeting().notesDraft.summary, "We met.");
assert.equal(meeting().notesDraft.generatedBy, "On-device: test model");
assert.equal(meeting().notesDraft.extra, undefined);
assert.equal(meeting().noteActionItems.length, 2);
await assert.rejects(
  () => client.mutation("meetings:saveNotesDraft", { id: "m_notes", template: "board_minutes", draft: {}, generatedBy: "x", usedNotes: true, usedTranscript: false }),
  /Unknown notes template/,
);
await assert.rejects(
  () => client.mutation("meetings:saveNotesDraft", { id: "m_notes", template: "general", draft: { summary: "" }, generatedBy: "x", usedNotes: true, usedTranscript: false }),
  /came back empty/,
);

// Edit one suggestion, link a goal and committee, then create its task.
const [call, hall] = meeting().noteActionItems as NoteActionItem[];
await client.mutation("meetings:setNoteActionItems", {
  id: "m_notes",
  items: [{ ...call, goalId: "g_1", committeeId: "c_1", assignee: "Sam", origin: "manual" }, hall],
});
await assert.rejects(
  () => client.mutation("meetings:setNoteActionItems", { id: "m_notes", items: [{ ...call, goalId: "missing_goal" }] }),
  /not found|Not found|unavailable/i,
  "links must be records of this workspace",
);
const created = await client.mutation("meetings:createTaskFromNoteAction", { id: "m_notes", itemId: call.id }) as { taskId: string; created: boolean };
assert.equal(created.created, true);
const task = tables().tasks.find((row) => row._id === created.taskId)!;
assert.equal(task.meetingId, "m_notes");
assert.equal(task.goalId, "g_1");
assert.equal(task.committeeId, "c_1");
assert.deepEqual(task.transcriptRef, { startSec: 125, endSec: 140 }, "the task keeps the moment in the recording");
assert.deepEqual(task.tags, ["meeting-notes"]);
assert.equal(meeting().noteActionItems[0].taskId, created.taskId, "the item links back to its task");
// Changes sent as ops apply to the list as it is now: a screen showing the list
// from before the task was created can't drop the task link or the other item.
await client.mutation("meetings:setNoteActionItems", { id: "m_notes", ops: [{ op: "patch", itemId: call.id, set: { done: true, status: "completed" }, unset: ["dueDate"] }] });
await client.mutation("meetings:setNoteActionItems", { id: "m_notes", ops: [{ op: "patch", itemId: hall.id, set: { assignee: "Jo" } }] });
assert.equal(meeting().noteActionItems[0].taskId, created.taskId, "a patch keeps the task link");
assert.equal(meeting().noteActionItems[0].done, true);
assert.equal(meeting().noteActionItems[1].assignee, "Jo", "both edits landed");
await client.mutation("meetings:setNoteActionItems", { id: "m_notes", ops: [{ op: "add", item: { id: "na_new", text: "New one", done: false, status: "open", origin: "manual" } }, { op: "remove", itemId: "na_new" }] });
assert.equal(meeting().noteActionItems.length, 2, "add then remove in one call");
await client.mutation("meetings:setNoteActionItems", { id: "m_notes", ops: [{ op: "patch", itemId: call.id, set: { done: false, status: "open", taskId: "forged" } }] });
assert.equal(meeting().noteActionItems[0].taskId, created.taskId, "a patch can't change the task link");
const again = await client.mutation("meetings:createTaskFromNoteAction", { id: "m_notes", itemId: call.id }) as { taskId: string; created: boolean };
assert.deepEqual(again, { taskId: created.taskId, created: false }, "creating twice returns the same task");
await assert.rejects(() => client.mutation("meetings:createTaskFromNoteAction", { id: "m_notes", itemId: "gone" }), /no longer on this meeting/);

// Redraft: the edited item with a task stays; the untouched suggestion is replaced.
await client.mutation("meetings:saveNotesDraft", {
  id: "m_notes", template: "general", draft: { summary: "Again.", actionItems: [{ text: "Email the board" }] }, generatedBy: "x", usedNotes: true, usedTranscript: false,
});
assert.deepEqual(meeting().noteActionItems.map((item: NoteActionItem) => item.text), ["Sam to call the funder", "Email the board"]);

// Discard: the draft and untouched suggestions go; the item with a task stays.
await client.mutation("meetings:discardNotesDraft", { id: "m_notes" });
assert.equal(meeting().notesDraft, undefined);
assert.deepEqual(meeting().noteActionItems.map((item: NoteActionItem) => item.text), ["Sam to call the funder"]);

// Turn notes into minutes: action items carry over with their task link.
await client.mutation("meetings:saveNotesDraft", {
  id: "m_notes", template: "general", draft: { summary: "Final.", decisions: ["Renew lease"], actionItems: [] }, generatedBy: "x", usedNotes: true, usedTranscript: false,
});
await client.mutation("meetings:startMinutesFromNotes", { id: "m_notes" });
const minutes = tables().minutes.find((row) => row.meetingId === "m_notes")!;
assert.deepEqual(minutes.actionItems.map((item: any) => [item.text, item.taskId]), [["Sam to call the funder", created.taskId]]);
assert.deepEqual(minutes.decisions, ["Renew lease"]);
assert.equal(minutes.discussion, "Raw notes stay.");
console.log("✓ local runtime: save, validate links, create task with transcript time, redraft, discard, carry into minutes");

// ---------- hosted: permissions and the action's rule-based fallback -------------
for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LLM_PROVIDER"]) delete process.env[name];
const issuer = betterAuthIssuer();
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./meetings.js": () => import("../convex/meetings"),
  "./transcripts.js": () => import("../convex/transcripts"),
  "./aiSettings.js": () => import("../convex/aiSettings"),
  "./authorization.js": () => import("../convex/authorization"),
});
const hostedIds = await t.run(async (ctx) => {
  const hostedSocietyId = await ctx.db.insert("societies", { name: "Notes hosted", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const user = (role: string, subject: string) => ctx.db.insert("users", {
    societyId: hostedSocietyId, email: `${subject}@portable-fixture.test`, displayName: role, role, status: "Active",
    authProvider: "better-auth", authIssuer: issuer, authSubject: subject, createdAtISO: "2026-01-01T00:00:00Z",
  });
  await user("Owner", PORTABLE_TEST_AUTH_SUBJECT);
  await user("Viewer", "notes-viewer");
  const hostedMeetingId = await ctx.db.insert("meetings", {
    societyId: hostedSocietyId, title: "Partner call", type: "Working", scheduledAt: "2026-04-01T18:00:00.000Z",
    electronic: true, status: "Held", attendeeIds: [], recordKind: "notes",
    workingNotes: "- Jo to send the MOU\n- We agreed to a pilot",
  });
  return { meetingId: hostedMeetingId };
});
const hostedMeetingId = hostedIds.meetingId as Id<"meetings">;
const owner = t.withIdentity({ subject: PORTABLE_TEST_AUTH_SUBJECT, issuer });
const viewer = t.withIdentity({ subject: "notes-viewer", issuer });
await assert.rejects(
  () => viewer.mutation(api.meetings.saveNotesDraft, { id: hostedMeetingId, template: "general", draft: { summary: "x" }, generatedBy: "x", usedNotes: true, usedTranscript: false }),
  /Permission meetings:write/,
);
await assert.rejects(() => viewer.mutation(api.meetings.setNoteActionItems, { id: hostedMeetingId, items: [] }), /Permission meetings:write/);
await assert.rejects(() => viewer.action(api.meetings.generateNotesDraft, { id: hostedMeetingId, template: "general" }), /Permission meetings:write/);
await assert.rejects(() => owner.action(api.meetings.generateNotesDraft, { id: hostedMeetingId, template: "minutes" }), /Unknown notes template/);
const hostedResult = await owner.action(api.meetings.generateNotesDraft, { id: hostedMeetingId, template: "external_call" }) as { actionItemsAdded: number };
const hostedMeeting = await t.run((ctx) => ctx.db.get(hostedMeetingId));
assert.equal(hostedMeeting?.notesDraft?.generatedBy, "Rule-based (no AI model connected)", "no model: the rule-based draft says so");
assert.equal(hostedMeeting?.notesDraft?.template, "external_call");
assert.deepEqual(hostedMeeting?.notesDraft?.decisions, ["We agreed to a pilot"]);
assert.equal(hostedResult.actionItemsAdded, 1);
assert.equal(hostedMeeting?.noteActionItems?.[0]?.text, "Jo to send the MOU");
assert.equal(hostedMeeting?.workingNotes, "- Jo to send the MOU\n- We agreed to a pilot", "hosted drafting never rewrites the notes");
console.log("✓ hosted: viewers refused; without a model the action saves a labelled rule-based draft");

// AI notes made from the transcript follow the transcript's read rule.
await owner.mutation(api.meetings.saveNotesDraft, {
  id: hostedMeetingId, template: "general",
  draft: { summary: "From the call.", quotes: [{ text: "We'll fund a pilot.", speaker: "Dana", atSec: 9 }] },
  generatedBy: "test", usedNotes: true, usedTranscript: true,
});
const ownerView = await owner.query(api.meetings.get, { id: hostedMeetingId }) as any;
assert.equal(ownerView.notesDraft?.summary, "From the call.", "people who may read the transcript see the AI notes");
assert.equal(ownerView.notesDraft?.quotes, undefined, "a quote that isn't in the transcript isn't saved");
const viewerView = await viewer.query(api.meetings.get, { id: hostedMeetingId }) as any;
assert.equal(viewerView.notesDraft, undefined, "a viewer doesn't get AI notes made from the transcript");
assert.equal(viewerView.notesDraftWithheld, true);
assert.equal(viewerView.workingNotes, "- Jo to send the MOU\n- We agreed to a pilot", "the notes themselves stay readable");
const hostedSocietyId = (await t.run((ctx) => ctx.db.get(hostedMeetingId)))!.societyId;
const viewerList = await viewer.query(api.meetings.list, { societyId: hostedSocietyId }) as any[];
const listed = viewerList.find((row) => row._id === hostedMeetingId);
assert.equal(listed.notesDraft, undefined, "the list never carries AI notes");
assert.equal(listed.hasNotesDraft, true);
await owner.mutation(api.meetings.saveNotesDraft, {
  id: hostedMeetingId, template: "general", draft: { summary: "From the notes." }, generatedBy: "test", usedNotes: true, usedTranscript: false,
});
assert.equal((await viewer.query(api.meetings.get, { id: hostedMeetingId }) as any).notesDraft?.summary, "From the notes.", "a draft from the notes alone follows the notes");
const formalId = await t.run((ctx) => ctx.db.insert("meetings", {
  societyId: hostedSocietyId, title: "Board", type: "Board", scheduledAt: "2026-04-02T18:00:00.000Z",
  electronic: true, status: "Held", attendeeIds: [], recordKind: "minutes", workingNotes: "- x",
}) as any);
await assert.rejects(() => owner.action(api.meetings.generateNotesDraft, { id: formalId, template: "general" }), /meetings that keep notes/);
console.log("✓ privacy: AI notes from the transcript withheld from readers without transcript access; lists only flag them; formal meetings refused");
