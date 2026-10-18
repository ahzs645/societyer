// What a meeting keeps (meetings.recordKind): pure helpers, create and update
// in the local runtime, "Turn notes into minutes", and hosted permissions.
//
//   node --import tsx scripts/check-meeting-record-kind.ts
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { StaticConvexClient } from "../src/lib/staticConvex";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { PORTABLE_TEST_AUTH_SUBJECT } from "./portable-test-fixture";
import {
  defaultRecordKindForType,
  discussionSeededWithNotes,
  meetingRecordKind,
  meetingRecordSteps,
  resolveMeetingTab,
  visibleMeetingTabs,
  type MeetingRecordKind,
} from "../shared/meetingRecordKind";

// ---------- pure helpers --------------------------------------------------------
assert.equal(meetingRecordKind({}), "minutes", "absent kind keeps formal minutes");
assert.equal(meetingRecordKind(null), "minutes", "a loading meeting behaves as minutes");
assert.equal(meetingRecordKind({ recordKind: "invented" }), "minutes", "unknown kinds fall back to minutes");
assert.equal(meetingRecordKind({ recordKind: "notes" }), "notes");

assert.deepEqual(
  [...visibleMeetingTabs(meetingRecordKind({}))],
  ["overview", "minutes", "transcript", "motions", "package", "export", "sources"],
  "absent kind shows exactly the tabs every meeting had before",
);
assert.deepEqual([...visibleMeetingTabs("notes")], ["overview", "notes", "transcript", "package", "sources"], "notes hide Motions and Export");
assert.deepEqual([...visibleMeetingTabs("meeting")], ["overview", "transcript", "package", "sources"]);
for (const kind of ["meeting", "notes", "minutes"] as const) {
  assert.ok(visibleMeetingTabs(kind).includes("transcript"), `${kind} keeps the Transcript tab`);
}

assert.equal(resolveMeetingTab("minutes", "notes"), "notes", "?tab=minutes on a notes meeting lands on Notes");
assert.equal(resolveMeetingTab("notes", "minutes"), "minutes", "?tab=notes on a minutes meeting lands on minutes");
assert.equal(resolveMeetingTab("motions", "notes"), "overview", "hidden tabs fall back to Overview");
assert.equal(resolveMeetingTab("minutes", "meeting"), "overview");
assert.equal(resolveMeetingTab("export", "minutes"), "export", "minutes meetings keep every deep link");
assert.equal(resolveMeetingTab(null, "minutes"), "overview");
assert.equal(resolveMeetingTab("bogus", "minutes"), "overview");

assert.equal(defaultRecordKindForType("Board"), "minutes");
assert.equal(defaultRecordKindForType("AGM"), "minutes");
assert.equal(defaultRecordKindForType("SGM"), "minutes");
assert.equal(defaultRecordKindForType("Committee"), "notes");
assert.equal(defaultRecordKindForType("Planning session"), "notes", "other types default to notes");

const states = (steps: ReturnType<typeof meetingRecordSteps>) => steps.map((step) => `${step.id}:${step.state}`);
assert.deepEqual(meetingRecordSteps({ kind: "meeting", hasTranscript: true, hasNotes: true, minutesStarted: false, minutesApproved: false }), []);
assert.deepEqual(
  states(meetingRecordSteps({ kind: "notes", hasTranscript: false, hasNotes: false, minutesStarted: false, minutesApproved: false })),
  ["transcript:upcoming", "notes:current", "minutesDraft:upcoming", "approved:upcoming"],
  "the optional transcript is never the current step",
);
assert.deepEqual(
  states(meetingRecordSteps({ kind: "notes", hasTranscript: true, hasNotes: true, minutesStarted: false, minutesApproved: false })),
  ["transcript:done", "notes:done", "minutesDraft:current", "approved:upcoming"],
);
assert.deepEqual(
  states(meetingRecordSteps({ kind: "minutes", hasTranscript: false, hasNotes: false, minutesStarted: true, minutesApproved: false })),
  ["transcript:upcoming", "minutesDraft:done", "approved:current"],
  "minutes meetings omit the Notes step when there are no notes",
);
assert.deepEqual(
  states(meetingRecordSteps({ kind: "minutes", hasTranscript: true, hasNotes: true, minutesStarted: true, minutesApproved: true })),
  ["transcript:done", "notes:done", "minutesDraft:done", "approved:done"],
  "nothing is current once the minutes are approved",
);

assert.equal(discussionSeededWithNotes("", "  Budget passed.  "), "Budget passed.");
assert.equal(discussionSeededWithNotes("Opened at 7.", "Budget passed."), "Opened at 7.\n\nBudget passed.");
assert.equal(discussionSeededWithNotes("Opened at 7.\n\nBudget passed.", "Budget passed."), null, "notes already in the draft are not repeated");
assert.equal(discussionSeededWithNotes("Anything", "   "), null, "empty notes change nothing");
console.log("✓ record kind helpers: absent = minutes, tabs, deep links, defaults, stepper, seeding");

// ---------- local runtime ------------------------------------------------------
const societyId = "record_kind_society";
const approvedAt = "2026-02-10";
const baseMeeting = { societyId, electronic: false, status: "Held", attendeeIds: ["Alex Example"] };
const baseMinutes = { societyId, heldAt: "2026-01-10T18:00:00.000Z", attendees: ["Alex Example"], absent: [], quorumMet: false, quorumStatus: "not_recorded", decisions: [], actionItems: [], sections: [] };
const client = new StaticConvexClient({ seed: {
  societies: [{ _id: societyId, name: "Record kind test", jurisdictionCode: "CA-BC", entityType: "society" }],
  meetings: [
    { _id: "m_legacy", ...baseMeeting, type: "Board", title: "Legacy board meeting", scheduledAt: "2026-01-10T18:00:00.000Z" },
    { _id: "m_approved", ...baseMeeting, type: "Committee", title: "Approved committee meeting", scheduledAt: "2026-01-11T18:00:00.000Z", recordKind: "notes", workingNotes: "Late notes.", minutesId: "min_approved" },
    { _id: "m_bare", ...baseMeeting, type: "Committee", title: "Imported notes meeting", scheduledAt: "2026-01-09T18:00:00.000Z", recordKind: "notes", workingNotes: "Notes with no minutes row." },
    { _id: "m_draft", ...baseMeeting, type: "Committee", title: "Drafted committee meeting", scheduledAt: "2026-01-12T18:00:00.000Z", recordKind: "notes", workingNotes: "Agreed to repaint the hall.", minutesId: "min_draft" },
  ],
  minutes: [
    { _id: "min_approved", ...baseMinutes, meetingId: "m_approved", discussion: "Adopted record.", approvedAt },
    { _id: "min_draft", ...baseMinutes, meetingId: "m_draft", discussion: "Called to order at 7." },
  ],
  meetingTemplates: [{
    _id: "tpl_committee",
    societyId,
    name: "Committee template",
    meetingType: "Committee",
    items: [
      { title: "Call to order" },
      { title: "Adopt the agenda", motionText: "BE IT RESOLVED THAT the agenda be adopted." },
      { title: "Grant applications" },
      { title: "Approve the grant shortlist", motionText: "THAT the committee approve the shortlist." },
    ],
    createdAtISO: "2026-01-01T00:00:00.000Z",
    updatedAtISO: "2026-01-01T00:00:00.000Z",
  }],
} });
await client.whenLocalWorkspaceReady();
const tables = () => client.exportLocalWorkspaceSnapshot().tables as Record<string, Array<Record<string, unknown>>>;
const meetingRow = (id: string) => tables().meetings.find((row) => row._id === id);
const minutesFor = (meetingId: string) => tables().minutes.filter((row) => row.meetingId === meetingId);

assert.equal(meetingRow("m_legacy")?.recordKind, undefined, "existing rows are not migrated");
assert.equal(meetingRecordKind(meetingRow("m_legacy")), "minutes");

const created: Record<MeetingRecordKind, string> = { meeting: "", notes: "", minutes: "" };
for (const kind of ["meeting", "notes", "minutes"] as const) {
  created[kind] = String(await client.mutation("meetings:create", {
    societyId,
    type: "Committee",
    title: `Created as ${kind}`,
    scheduledAt: "2026-03-01T18:00:00.000Z",
    electronic: false,
    status: "Scheduled",
    attendeeIds: [],
    recordKind: kind,
  }));
  assert.equal(meetingRow(created[kind])?.recordKind, kind, `create stores recordKind ${kind}`);
}
await assert.rejects(
  () => client.mutation("meetings:create", { societyId, type: "Board", title: "Bad", scheduledAt: "2026-03-02T18:00:00.000Z", electronic: false, status: "Scheduled", attendeeIds: [], recordKind: "transcript" }),
  /just the meeting, notes, or minutes/,
);
await assert.rejects(
  () => client.mutation("meetings:update", { id: created.notes, patch: { recordKind: "everything" } }),
  /just the meeting, notes, or minutes/,
);
await client.mutation("meetings:update", { id: created.notes, patch: { workingNotes: "Quorum present.\n\n- Paint the hall" } });
assert.equal(meetingRow(created.notes)?.workingNotes, "Quorum present.\n\n- Paint the hall", "notes autosave through meetings:update");
await assert.rejects(
  () => client.mutation("meetings:update", { id: created.notes, patch: { workingNotes: "x".repeat(100_001) } }),
  /too long/,
);
assert.equal(meetingRow(created.notes)?.notes, undefined, "working notes never touch the preparation notes field");
console.log("✓ create and update: each kind stored, invalid kinds and oversized notes rejected");

// Notes → minutes on a new meeting: its empty minutes stub takes the notes.
const stub = minutesFor(created.notes);
assert.equal(stub.length, 1, "meetings:create scaffolds a minutes stub for every kind");
assert.equal(String(stub[0].discussion ?? ""), "");
const fresh = await client.mutation("meetings:startMinutesFromNotes", { id: created.notes }) as { minutesId: string; seeded: boolean; approved: boolean };
assert.equal(fresh.seeded, true);
assert.equal(fresh.approved, false);
assert.equal(fresh.minutesId, stub[0]._id, "the existing stub is seeded, not replaced");
assert.equal(meetingRow(created.notes)?.recordKind, "minutes", "the meeting now keeps minutes");
const freshMinutes = minutesFor(created.notes);
assert.equal(freshMinutes.length, 1);
assert.equal(freshMinutes[0].discussion, "Quorum present.\n\n- Paint the hall", "the notes seed the minutes discussion");
assert.equal(freshMinutes[0].approvedAt, undefined);
assert.equal(meetingRow(created.notes)?.workingNotes, "Quorum present.\n\n- Paint the hall", "the notes stay on file");
// Running it again does not duplicate the minutes or the notes.
const again = await client.mutation("meetings:startMinutesFromNotes", { id: created.notes }) as { seeded: boolean };
assert.equal(again.seeded, false);
assert.equal(minutesFor(created.notes).length, 1);
assert.equal(minutesFor(created.notes)[0].discussion, "Quorum present.\n\n- Paint the hall");

// No minutes row at all (imported meetings): a fresh draft is created.
assert.equal(minutesFor("m_bare").length, 0);
const bare = await client.mutation("meetings:startMinutesFromNotes", { id: "m_bare" }) as { minutesId: string; seeded: boolean };
assert.equal(bare.seeded, true);
const bareMinutes = minutesFor("m_bare");
assert.equal(bareMinutes.length, 1);
assert.equal(bareMinutes[0].discussion, "Notes with no minutes row.");
assert.deepEqual(bareMinutes[0].attendees, ["Alex Example"], "the draft starts from the meeting's attendees");
assert.equal(bareMinutes[0].quorumStatus, "not_recorded", "notes never claim quorum");
assert.equal(meetingRow("m_bare")?.minutesId, bare.minutesId, "the meeting links its new minutes");

// Existing draft: the notes follow what is already there.
const drafted = await client.mutation("meetings:startMinutesFromNotes", { id: "m_draft" }) as { minutesId: string; seeded: boolean };
assert.equal(drafted.minutesId, "min_draft");
assert.equal(drafted.seeded, true);
assert.equal(minutesFor("m_draft")[0].discussion, "Called to order at 7.\n\nAgreed to repaint the hall.");

// Approved minutes are never touched.
const approvedBefore = JSON.stringify(minutesFor("m_approved")[0]);
const approved = await client.mutation("meetings:startMinutesFromNotes", { id: "m_approved" }) as { seeded: boolean; approved: boolean };
assert.equal(approved.seeded, false);
assert.equal(approved.approved, true);
assert.equal(JSON.stringify(minutesFor("m_approved")[0]), approvedBefore, "approved minutes are byte-for-byte unchanged");
assert.equal(meetingRow("m_approved")?.recordKind, "minutes");

// Templates: notes and no-write-up meetings keep the agenda topics and the
// snapshot but get no motions; "Turn notes into minutes" adds them from the
// snapshot, once. Formal minutes get them at creation, as before.
const motionsFor = (meetingId: string) => tables().motions?.filter((row) => row.primaryMeetingId === meetingId) ?? [];
const agendaTitlesFor = (meetingId: string) => {
  const agenda = tables().agendas.find((row) => row.meetingId === meetingId);
  return tables().agendaItems
    .filter((row) => row.agendaId === agenda?._id)
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((row) => row.title);
};
const fromTemplate: Record<MeetingRecordKind, string> = { meeting: "", notes: "", minutes: "" };
for (const kind of ["meeting", "notes", "minutes"] as const) {
  fromTemplate[kind] = String(await client.mutation("meetings:create", {
    societyId,
    type: "Committee",
    title: `From template as ${kind}`,
    scheduledAt: "2026-05-01T18:00:00.000Z",
    electronic: false,
    status: "Scheduled",
    attendeeIds: [],
    meetingTemplateId: "tpl_committee",
    recordKind: kind,
  }));
  assert.deepEqual(
    agendaTitlesFor(fromTemplate[kind]),
    ["Call to order", "Adopt the agenda", "Grant applications", "Approve the grant shortlist"],
    `${kind}: the template's agenda topics are kept`,
  );
  assert.ok(meetingRow(fromTemplate[kind])?.templateSnapshotJson, `${kind}: the template is snapshotted`);
}
assert.equal(motionsFor(fromTemplate.notes).length, 0, "notes from a template get no motions");
assert.equal(motionsFor(fromTemplate.meeting).length, 0, "no-write-up meetings from a template get no motions");
assert.deepEqual((minutesFor(fromTemplate.notes)[0].motionIds as unknown[] | undefined) ?? [], [], "the notes minutes stub lists no motions");
assert.deepEqual(
  motionsFor(fromTemplate.minutes).map((row) => row.text),
  ["BE IT RESOLVED THAT the agenda be adopted.", "THAT the committee approve the shortlist."],
  "formal minutes still get the template's motions at creation",
);
const converted = await client.mutation("meetings:startMinutesFromNotes", { id: fromTemplate.notes }) as { motionsSeeded: number };
assert.equal(converted.motionsSeeded, 2, "turning notes into minutes adds the template's motions");
assert.deepEqual(
  motionsFor(fromTemplate.notes).map((row) => [row.text, row.sectionIndex]),
  [
    ["BE IT RESOLVED THAT the agenda be adopted.", 1],
    ["THAT the committee approve the shortlist.", 3],
  ],
  "seeded motions sit on their agenda topics",
);
assert.equal((minutesFor(fromTemplate.notes)[0].motionIds as unknown[]).length, 2, "the minutes list the seeded motions");
const convertedAgain = await client.mutation("meetings:startMinutesFromNotes", { id: fromTemplate.notes }) as { motionsSeeded: number };
assert.equal(convertedAgain.motionsSeeded, 0, "motions are seeded once");
assert.equal(motionsFor(fromTemplate.notes).length, 2);
// "Start minutes" on a no-write-up meeting (no notes) goes through the same mutation.
const startedFromMeeting = await client.mutation("meetings:startMinutesFromNotes", { id: fromTemplate.meeting }) as { seeded: boolean; motionsSeeded: number };
assert.equal(startedFromMeeting.seeded, false, "no notes, nothing copied");
assert.equal(startedFromMeeting.motionsSeeded, 2);
const approvedTemplateMotions = await client.mutation("meetings:startMinutesFromNotes", { id: "m_approved" }) as { motionsSeeded: number };
assert.equal(approvedTemplateMotions.motionsSeeded, 0, "approved minutes never get motions");
console.log("✓ templates: notes keep the agenda but no motions; turning them into minutes adds the motions once");

// Switching back to notes keeps the minutes.
await client.mutation("meetings:update", { id: "m_draft", patch: { recordKind: "notes" } });
assert.equal(minutesFor("m_draft").length, 1, "minutes survive a switch back to notes");
console.log("✓ notes → minutes: creates or seeds the draft, idempotent, approved minutes untouched");

// ---------- hosted permissions -------------------------------------------------
const issuer = betterAuthIssuer();
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./meetings.js": () => import("../convex/meetings"),
});
const ids = await t.run(async (ctx) => {
  const hostedSocietyId = await ctx.db.insert("societies", { name: "Record kind", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const user = (role: string, subject: string) => ctx.db.insert("users", {
    societyId: hostedSocietyId,
    email: `${subject}@portable-fixture.test`,
    displayName: role,
    role,
    status: "Active",
    authProvider: "better-auth",
    authIssuer: issuer,
    authSubject: subject,
    createdAtISO: "2026-01-01T00:00:00Z",
  });
  await user("Owner", PORTABLE_TEST_AUTH_SUBJECT);
  await user("Director", "record-kind-director");
  await user("Viewer", "record-kind-viewer");
  await user("Member", "record-kind-member");
  const meetingId = await ctx.db.insert("meetings", {
    societyId: hostedSocietyId,
    title: "Hosted notes",
    type: "Committee",
    scheduledAt: "2026-04-01T18:00:00.000Z",
    electronic: false,
    status: "Held",
    attendeeIds: [],
    recordKind: "notes",
    workingNotes: "Hosted notes text.",
  });
  return { societyId: hostedSocietyId, meetingId };
});
const as = (subject: string) => t.withIdentity({ subject, issuer });
const meetingId = ids.meetingId as Id<"meetings">;

await assert.rejects(() => t.mutation(api.meetings.startMinutesFromNotes, { id: meetingId }), /Authentication required/);
for (const subject of ["record-kind-viewer", "record-kind-member"]) {
  await assert.rejects(() => as(subject).mutation(api.meetings.startMinutesFromNotes, { id: meetingId }), /Permission meetings:write/, `${subject} cannot turn notes into minutes`);
  await assert.rejects(() => as(subject).mutation(api.meetings.update, { id: meetingId, patch: { workingNotes: "Edited" } }), /Permission meetings:write/, `${subject} cannot edit notes`);
}
await assert.rejects(
  () => as(PORTABLE_TEST_AUTH_SUBJECT).mutation(api.meetings.update, { id: meetingId, patch: { recordKind: "draft" as unknown as MeetingRecordKind } }),
  /Validator|recordKind/,
  "the hosted validator only accepts the three kinds",
);
await as("record-kind-director").mutation(api.meetings.update, { id: meetingId, patch: { workingNotes: "Director notes." } });
const hostedResult = await as("record-kind-director").mutation(api.meetings.startMinutesFromNotes, { id: meetingId }) as { seeded: boolean };
assert.equal(hostedResult.seeded, true, "a director (meetings:write + minutes:write) turns notes into minutes");
const hosted = await t.run(async (ctx) => ({
  meeting: await ctx.db.get(meetingId),
  minutes: await ctx.db.query("minutes").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).collect(),
}));
assert.equal(hosted.meeting?.recordKind, "minutes");
assert.equal(hosted.minutes.length, 1);
assert.equal(hosted.minutes[0].discussion, "Director notes.");
console.log("✓ permissions: viewers and members are refused; directors can write notes and start minutes");
