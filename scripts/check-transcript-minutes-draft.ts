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
  RECORDED_SECTIONS_DRAFT_BLOCKED,
  minutesDraftBlocker,
  minutesDraftTranscript,
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
  "./meetings.js": () => import("../convex/meetings"),
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

// 5. Pure pieces: blockers, explicit text, import metadata, empty transcript.
assert.equal(minutesDraftBlocker(null), null);
assert.equal(minutesDraftBlocker({ discussion: "Working draft", sections: [] }), null);
assert.equal(minutesDraftBlocker({ motionSnapshots: [] }), ADOPTED_MINUTES_DRAFT_BLOCKED);
assert.equal(
  minutesDraftBlocker({ sections: [{ title: "Budget", discussion: "Recorded" }] }),
  RECORDED_SECTIONS_DRAFT_BLOCKED,
);
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
await assert.rejects(
  () => owner.action(api.minutes.generateDraft, { meetingId: emptyMeeting, transcript: "   " }),
  /Add a transcript first/,
);
assert.equal(prompts.length, 1, "an empty transcript never reaches the model");

globalThis.fetch = realFetch;
console.log(
  "Transcript minutes draft passed: assigned names reach the model prompt verbatim, renames stay authoritative, and approved minutes are refused before any model call.",
);
