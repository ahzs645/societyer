/**
 * "Draft minutes from transcript" input path, end to end on the Convex side
 * with a mocked language model:
 *
 *   timed import -> assign speaker names -> the page's transcript choice
 *   (minutesDraftTranscript) -> minutes:generateDraft -> model request body
 *   -> minutes row, then approval freezes the minutes against later drafts.
 *
 * The model is the OpenAI-compatible provider pointed at a fixture host, so
 * the exact prompt the deployment would send is captured.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import {
  ADOPTED_MINUTES_DRAFT_BLOCKED,
  matchesTemplateText,
  minutesDraftBlocker,
  minutesDraftTranscript,
  recordedSectionsDraftBlocked,
  withoutTemplateSeededSections,
} from "../shared/minutesDraftInput";

delete process.env.ANTHROPIC_API_KEY;
process.env.OPENAI_API_KEY = "fixture-not-a-real-key";
process.env.OPENAI_API_BASE_URL = "https://llm.example.test/v1/chat/completions";

type ChatMessage = { role: string; content: string };
const prompts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.hostname !== "llm.example.test") return realFetch(input, init);
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-not-a-real-key");
  const body = JSON.parse(String(init?.body)) as { messages: ChatMessage[] };
  prompts.push(body.messages.find((message) => message.role === "user")?.content ?? "");
  const draft = {
    discussion: "Jane Doe called the meeting to order. John Roe moved to approve the budget.",
    motions: [{ text: "Approve the 2027 budget", movedBy: "John Roe", outcome: "Carried" }],
    decisions: ["Budget approved"],
    actionItems: [],
    attendees: ["Jane Doe", "John Roe"],
    absent: [],
  };
  return Response.json({ choices: [{ message: { content: JSON.stringify(draft) } }] });
};

const issuer = betterAuthIssuer();
const modules: Record<string, () => Promise<unknown>> = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./agendas.js": () => import("../convex/agendas"),
  "./meetings.js": () => import("../convex/meetings"),
  "./meetingTemplates.js": () => import("../convex/meetingTemplates"),
  "./minutes.js": () => import("../convex/minutes"),
  "./transcripts.js": () => import("../convex/transcripts"),
};
const test = convexTest(schema, modules);
const { societyId, meetingId } = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", {
    name: "Transcript drafting",
    isCharity: false,
    isMemberFunded: false,
    updatedAt: Date.now(),
  });
  await ctx.db.insert("users", {
    societyId,
    role: "Owner",
    status: "Active",
    email: "owner@example.test",
    displayName: "Owner",
    authSubject: "owner",
    authIssuer: issuer,
    authProvider: "better-auth",
    createdAtISO: new Date().toISOString(),
  });
  const meetingId = await ctx.db.insert("meetings", {
    societyId,
    title: "October board meeting",
    type: "Board",
    scheduledAt: "2026-10-04T18:00:00Z",
    electronic: false,
    status: "Held",
    attendeeIds: [],
  });
  return { societyId, meetingId };
});
const owner = test.withIdentity({ subject: "owner", issuer });

// What the meeting page sends: the same helper and the same live query rows.
async function pageTranscriptChoice() {
  const row = await owner.query(api.transcripts.getByMeeting, { meetingId });
  const minutes = await owner.query(api.minutes.getByMeeting, { meetingId });
  return minutesDraftTranscript({
    transcriptRow: row,
    draftTranscript: String(minutes?.draftTranscript ?? ""),
    draftIsImportMetadata: false,
  });
}
const minutesRow = () =>
  test.run((ctx) =>
    ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .first(),
  );

// 1. Timed import keeps raw diarization labels; assignment rewrites `text`.
await owner.mutation(api.transcripts.importTimed, {
  societyId,
  meetingId,
  provider: "vtt",
  segments: [
    { speaker: "SPEAKER_00", text: "I call the meeting to order.", startSec: 0, endSec: 3 },
    { speaker: "SPEAKER_01", text: "I move to approve the 2027 budget.", startSec: 3, endSec: 7 },
    { speaker: "SPEAKER_00", text: "All in favour? Carried.", startSec: 7, endSec: 10 },
  ],
});
await owner.mutation(api.transcripts.assignSpeaker, {
  societyId,
  meetingId,
  label: "SPEAKER_00",
  name: "Jane Doe",
});
await owner.mutation(api.transcripts.assignSpeaker, {
  societyId,
  meetingId,
  label: "SPEAKER_01",
  name: "John Roe",
});
const named = await pageTranscriptChoice();
assert.match(named, /^Jane Doe: I call the meeting to order\.$/m);
assert.match(named, /^John Roe: I move to approve the 2027 budget\.$/m);
assert.doesNotMatch(named, /SPEAKER_0\d/, "the page sends assigned names, not diarization labels");

// 2. The model receives exactly that text, and the draft is stored with it.
await owner.action(api.minutes.generateDraft, { meetingId, transcript: named });
assert.equal(prompts.length, 1, "one model request per draft");
assert.ok(prompts[0].includes(`Transcript:\n${named}`), "the prompt carries the named transcript verbatim");
assert.doesNotMatch(prompts[0], /SPEAKER_0\d/);
assert.ok(prompts[0].includes("Meeting title: October board meeting"));
const drafted = await minutesRow();
assert.equal(drafted?.draftTranscript, named);
assert.match(String(drafted?.discussion), /Jane Doe called the meeting to order/);

// 3. A later rename reaches the next draft: the row is authoritative over a stale copy.
await owner.mutation(api.transcripts.assignSpeaker, {
  societyId,
  meetingId,
  label: "SPEAKER_01",
  name: "John Q. Roe",
});
const renamed = await pageTranscriptChoice();
assert.match(renamed, /^John Q\. Roe: I move/m);
assert.equal((await minutesRow())?.draftTranscript, renamed, "unapproved draft transcript stays in sync");
assert.equal(
  minutesDraftTranscript({
    transcriptRow: { text: renamed },
    draftTranscript: "SPEAKER_00: I call the meeting to order.",
  }),
  renamed,
  "a stale minutes.draftTranscript never wins over the transcript row",
);

// 4. Approved minutes are frozen: no model call, no write, no transcript sync.
await owner.mutation(api.minutes.update, {
  id: drafted!._id,
  patch: { discussion: "", sections: [], approvedAt: "2026-10-04", approvedInMeetingId: meetingId },
});
const approved = await minutesRow();
assert.ok(approved?.approvedAt);
assert.equal(
  minutesDraftBlocker(await owner.query(api.minutes.getByMeeting, { meetingId })),
  ADOPTED_MINUTES_DRAFT_BLOCKED,
);
await assert.rejects(
  () => owner.action(api.minutes.generateDraft, { meetingId, transcript: renamed }),
  /Adopted minutes are frozen/,
);
assert.equal(prompts.length, 1, "approved minutes are refused before the model is called");
await assert.rejects(
  () =>
    owner.mutation(api.minutes.upsertFromDraft, {
      societyId,
      meetingId,
      heldAt: "2026-10-04",
      attendees: [],
      absent: [],
      quorumMet: false,
      discussion: "Overwrite attempt",
      motions: [],
      decisions: [],
      actionItems: [],
    }),
  /Adopted minutes are frozen/,
  "the authoritative upsert refuses approved minutes too",
);
await owner.mutation(api.transcripts.assignSpeaker, {
  societyId,
  meetingId,
  label: "SPEAKER_00",
  name: "J. Doe",
});
const after = await minutesRow();
assert.deepEqual(
  { approvedAt: after?.approvedAt, discussion: after?.discussion, draftTranscript: after?.draftTranscript },
  {
    approvedAt: approved?.approvedAt,
    discussion: approved?.discussion,
    draftTranscript: approved?.draftTranscript,
  },
  "approved minutes are unchanged by drafting attempts and later speaker renames",
);

// 5. A board meeting made from the default "Regular board meeting" template:
//    its seeded sections (the land acknowledgement, the procedural motions'
//    wording) are not recorded content, so drafting proceeds; a section a
//    person changed is refused by name.
await owner.mutation(api.meetingTemplates.seedDefaults, { societyId });
const boardTemplate = (await owner.query(api.meetingTemplates.list, { societyId }))
  .find((template: { name: string }) => template.name === "Regular board meeting");
assert.ok(boardTemplate, "the default board template is seeded");
const createFromTemplate = (title: string) =>
  owner.mutation(api.meetings.create, {
    societyId,
    type: "Board",
    title,
    scheduledAt: "2026-12-04T18:00:00Z",
    electronic: false,
    status: "Held",
    attendeeIds: [],
    meetingTemplateId: boardTemplate._id,
  });
const templated = await createFromTemplate("December board meeting");
// The page's "Start minutes from agenda" re-sync copies each agenda item's
// resolved motion wording onto its section, as the QA repro had it.
const templatedAgenda = await owner.query(api.agendas.getForMeeting, { meetingId: templated });
await owner.mutation(api.agendas.startMinutesFromAgenda, { agendaId: templatedAgenda!.agenda._id });
const templatedMeeting = await owner.query(api.meetings.get, { id: templated });
const templatedMinutes = await owner.query(api.minutes.getByMeeting, { meetingId: templated });
const seededSections = (templatedMinutes?.sections ?? []) as Array<{ title: string; discussion?: string; motionText?: string }>;
assert.match(
  String(seededSections.find((section) => section.title === "Indigenous acknowledgement")?.discussion),
  /unceded and ancestral territory/,
  "the template seeds the land acknowledgement",
);
assert.match(
  String(seededSections.find((section) => section.title === "Adopt previous minutes")?.motionText),
  /^BE IT RESOLVED THAT the minutes of .+, as circulated, be approved\.$/,
  "the template's placeholders were filled in",
);
assert.notEqual(minutesDraftBlocker(templatedMinutes), null, "without the template, its defaults look recorded (the QA refusal)");
assert.equal(minutesDraftBlocker(templatedMinutes, templatedMeeting), null, "template defaults alone never block a draft");
assert.deepEqual(
  withoutTemplateSeededSections(templatedMinutes!, templatedMeeting).sections,
  [],
  "template defaults alone are not a started draft, so no replace prompt",
);
const promptsBeforeTemplate = prompts.length;
await owner.action(api.minutes.generateDraft, { meetingId: templated, transcript: named });
assert.equal(prompts.length, promptsBeforeTemplate + 1, "a template meeting is drafted");
assert.match(String((await owner.query(api.minutes.getByMeeting, { meetingId: templated }))?.discussion), /Jane Doe called the meeting to order/);

const edited = await createFromTemplate("January board meeting");
const editedMinutes = await owner.query(api.minutes.getByMeeting, { meetingId: edited });
await owner.mutation(api.minutes.update, {
  id: editedMinutes!._id,
  patch: {
    sections: (editedMinutes!.sections as Array<Record<string, unknown>>).map((section) =>
      section.title === "Indigenous acknowledgement"
        ? { ...section, discussion: `${section.discussion} Elder Mary Charlie offered a welcome.` }
        : section.title === "New business"
          ? { ...section, decisions: ["Hall rental renewed"] }
          : section),
  },
});
const editedBlocked = recordedSectionsDraftBlocked(["Indigenous acknowledgement", "New business"]);
assert.equal(
  editedBlocked,
  "“Indigenous acknowledgement” and “New business” have recorded content, which a draft never overwrites. Edit or clear those sections, then draft again.",
);
assert.equal(
  minutesDraftBlocker(await owner.query(api.minutes.getByMeeting, { meetingId: edited }), await owner.query(api.meetings.get, { id: edited })),
  editedBlocked,
  "changed template wording and an added decision are recorded content, named in the refusal",
);
await assert.rejects(
  () => owner.action(api.minutes.generateDraft, { meetingId: edited, transcript: named }),
  (error: Error) => error.message.includes(editedBlocked),
  "the hosted action refuses edited template sections before the model",
);
assert.equal(prompts.length, promptsBeforeTemplate + 1, "the refused draft never reaches the model");
await assert.rejects(
  () =>
    owner.mutation(api.minutes.upsertFromDraft, {
      societyId,
      meetingId: edited,
      heldAt: "2026-12-04",
      attendees: [],
      absent: [],
      quorumMet: false,
      discussion: "Overwrite attempt",
      motions: [],
      decisions: [],
      actionItems: [],
    }),
  (error: Error) => error.message.includes(editedBlocked),
  "the authoritative upsert refuses them too",
);

// 6. Pure pieces: blockers, explicit text, import metadata, empty transcript.
assert.equal(minutesDraftBlocker(null), null);
assert.equal(minutesDraftBlocker({ discussion: "Working draft", sections: [] }), null);
assert.equal(minutesDraftBlocker({ motionSnapshots: [] }), ADOPTED_MINUTES_DRAFT_BLOCKED);
assert.equal(
  minutesDraftBlocker({ approvedAt: "2026-10-04", sections: [] }, templatedMeeting),
  ADOPTED_MINUTES_DRAFT_BLOCKED,
  "approved minutes are refused whatever the template",
);
assert.equal(
  minutesDraftBlocker({ sections: [{ title: "Budget", discussion: "Recorded" }] }),
  "“Budget” has recorded content, which a draft never overwrites. Edit or clear that section, then draft again.",
);
assert.equal(
  recordedSectionsDraftBlocked(["A", "B", "C", "D", "E"]),
  "“A”, “B”, “C” and 2 more have recorded content, which a draft never overwrites. Edit or clear those sections, then draft again.",
);
const snapshot = (items: unknown[]) => ({ templateSnapshotJson: JSON.stringify({ items }) });
assert.equal(
  minutesDraftBlocker(
    { sections: [{ title: "Welcome", discussion: "  Opening\n remarks " }] },
    snapshot([{ title: "Welcome", details: "Opening remarks" }]),
  ),
  null,
  "whitespace differences from the template don't count",
);
assert.notEqual(
  minutesDraftBlocker(
    { sections: [{ title: "Welcome", discussion: "Opening remarks", motionId: "motion_1" }] },
    snapshot([{ title: "Welcome", details: "Opening remarks" }]),
  ),
  null,
  "a linked motion is recorded even under template wording",
);
assert.notEqual(
  minutesDraftBlocker(
    { sections: [{ title: "Another title", discussion: "Opening remarks" }] },
    snapshot([{ title: "Welcome", details: "Opening remarks" }]),
  ),
  null,
  "template wording under a section the template didn't make is recorded",
);
assert.notEqual(minutesDraftBlocker({ sections: [{ title: "Welcome", discussion: "Opening remarks" }] }, { templateSnapshotJson: "{not json" }), null);
assert.ok(matchesTemplateText("Minutes of the previous meeting, approved.", "Minutes of {{previousMeetingTitle}} of {{previousMeetingDate}}, approved."));
assert.ok(matchesTemplateText("Minutes of Board meeting of May 1, 2026, approved.", "Minutes of {{previousMeetingTitle}} of {{previousMeetingDate}}, approved."));
assert.ok(!matchesTemplateText("Minutes of May, approved with changes.", "Minutes of {{previousMeetingTitle}} of {{previousMeetingDate}}, approved."));
assert.ok(!matchesTemplateText("Costs (approx.) rose", "Costs (approx) rose"), "template text is literal, not a pattern");
assert.equal(
  minutesDraftBlocker({ sections: [{ title: "Budget", discussion: "" }] }),
  null,
  "an empty agenda scaffold may be drafted",
);
assert.equal(
  minutesDraftTranscript({ explicitText: "  Pasted  ", transcriptRow: { text: "Row" } }),
  "Pasted",
);
assert.equal(minutesDraftTranscript({ transcriptRow: null, draftTranscript: " Copy " }), "Copy");
assert.equal(
  minutesDraftTranscript({ draftTranscript: '{"kind":"import"}', draftIsImportMetadata: true }),
  "",
);
const emptyMeeting = await test.run((ctx) =>
  ctx.db.insert("meetings", {
    societyId,
    title: "Empty",
    type: "Board",
    scheduledAt: "2026-11-04T18:00:00Z",
    electronic: false,
    status: "Held",
    attendeeIds: [],
  }),
);
const promptsBeforeEmpty = prompts.length;
await assert.rejects(
  () => owner.action(api.minutes.generateDraft, { meetingId: emptyMeeting, transcript: "   " }),
  /Add a transcript first/,
);
assert.equal(prompts.length, promptsBeforeEmpty, "an empty transcript never reaches the model");

globalThis.fetch = realFetch;
console.log(
  "Transcript minutes draft passed: assigned names reach the model prompt verbatim, renames stay authoritative, approved minutes are refused before any model call, and template-seeded sections never block a draft while edited ones are refused by name.",
);
