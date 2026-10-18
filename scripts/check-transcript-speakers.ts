/**
 * Speaker combine/unmerge, the Review speakers suggestions, and the Meeting
 * source files timed-transcript offer. Hermetic: fixtures are inline copies of
 * /tmp/societyer-transcript/fixture/board-meeting.{oversplit.whisperx.json,teams.vtt}.
 */
import assert from "node:assert/strict";
import {
  MemoryDb,
  LocalStoreDb,
  MemoryRowStore,
  PortableRuntime,
  makeCapabilities,
  type PortablePrincipal,
} from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { actionPermission } from "../shared/functions/actionPolicy";
import {
  resolveSpeakerLabel,
  resolvedSpeakerLabels,
  speakerName,
  transcriptText,
  SPEAKER_MERGE_MAX_DEPTH,
  type TranscriptSegment,
  type TranscriptSpeaker,
} from "../shared/transcriptModel";
import { parseTimedTranscript } from "../src/features/meetings/transcript/timedTranscript";
import {
  combineGroups,
  needsSpeakerReview,
  normalizeSpeakerKey,
  speakerStats,
  speakerSuggestions,
} from "../src/features/meetings/transcript/speakerSuggestions";
import { displaySegments, speakerTurns } from "../src/features/meetings/transcript/speakerTurns";
import { showCandidateGroups, speakerCandidates } from "../src/features/meetings/transcript/speakerCandidates";
import {
  REPLACE_TRANSCRIPT_CONFIRM,
  timedTranscriptOffer,
} from "../src/features/meetings/transcript/timedImportOffer";
import { StreamingZipWriter } from "../src/lib/zipStream";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

// Inline copy of board-meeting.oversplit.whisperx.json (words omitted):
// SPEAKER_04 is really SPEAKER_01, and "speaker_03 " is really SPEAKER_03.
const oversplitJson = JSON.stringify({
  language: "en",
  segments: [
    ["SPEAKER_00", 0, 7.051, "Good evening everyone. I'm calling the meeting to order at seven oh two."],
    ["SPEAKER_01", 7.651, 13.1, "Thanks. Before we start, I'd like to add the community garden lease."],
    ["SPEAKER_00", 13.7, 19.431, "Noted. Next item is the twenty twenty seven operating budget."],
    ["SPEAKER_02", 20.031, 26.652, "The headline is a small surplus of about four thousand dollars."],
    ["SPEAKER_02", 27.252, 30.233, "I move that we approve the draft budget as circulated."],
    [
      "SPEAKER_04",
      30.833,
      35.132,
      "Seconded. I'll note for the minutes that the reserve policy still applies.",
    ],
    ["SPEAKER_03", 35.732, 41.238, "Before we vote, I can take the grant report back to the funder."],
    ["SPEAKER_00", 41.838, 45.87, "All in favour? Any opposed? The motion carries unanimously."],
    ["speaker_03 ", 46.47, 50.744, "Action item for me then: the grant report by November fifteenth."],
    ["SPEAKER_00", 51.344, 55.757, "Thank you. With no further business, the meeting is adjourned."],
  ].map(([speaker, start, end, text]) => ({ speaker, start, end, text })),
});
// Inline copy of board-meeting.teams.vtt: voice names are the demo attendees.
const teamsVtt = [
  "WEBVTT",
  "",
  ...[
    [
      "00:00:00.000",
      "00:00:07.051",
      "Mina Patel",
      "Good evening everyone. I'm calling the meeting to order.",
    ],
    [
      "00:00:07.651",
      "00:00:13.100",
      "Jordan Lee",
      "Thanks. Before we start, I'd like to add the garden lease.",
    ],
    ["00:00:13.700", "00:00:19.431", "Mina Patel", "Noted. Next item is the operating budget."],
    [
      "00:00:20.031",
      "00:00:26.652",
      "Devon Clarke",
      "The headline is a small surplus of about four thousand dollars.",
    ],
    ["00:00:30.833", "00:00:35.132", "Jordan Lee", "Seconded. The reserve policy still applies."],
    [
      "00:00:35.732",
      "00:00:41.238",
      "Avery Santos",
      "Before we vote, I can take the grant report back to the funder.",
    ],
  ].flatMap(([start, end, voice, text], index) => [
    `${String(index + 1).padStart(4, "0")}-cue`,
    `${start} --> ${end}`,
    `<v ${voice}>${text}</v>`,
    "",
  ]),
].join("\n");
const demoAttendees = [
  { name: "Mina Patel", personId: "person-mina" },
  { name: "Jordan Lee", personId: "person-jordan" },
  { name: "Devon Clarke" },
  { name: "Avery Santos", personId: "person-avery" },
];

// --- Pure model: resolution, chains, cycles, text and turns -----------------
{
  const speakers: TranscriptSpeaker[] = [
    { label: "A", name: "Alex", mergedInto: "B" },
    { label: "B", mergedInto: "C" },
    { label: "C", name: "Casey" },
    { label: "X", mergedInto: "Y" },
    { label: "Y", mergedInto: "X" },
  ];
  assert.equal(resolveSpeakerLabel("A", speakers), "C", "chains resolve transitively");
  assert.equal(speakerName("A", speakers), "Casey", "a combined label shows its target's name");
  assert.equal(speakerName("B", speakers), "Casey");
  assert.equal(resolveSpeakerLabel("X", speakers), "X", "a cycle leaves each label standing alone");
  assert.equal(resolveSpeakerLabel("Y", speakers), "Y");
  assert.equal(resolveSpeakerLabel("unknown", speakers), "unknown");
  const long: TranscriptSpeaker[] = Array.from({ length: SPEAKER_MERGE_MAX_DEPTH + 2 }, (_, index) => ({
    label: `L${index}`,
    mergedInto: `L${index + 1}`,
  }));
  assert.equal(resolveSpeakerLabel("L0", long), "L0", "an overlong chain is ignored, not followed");
  assert.equal(resolveSpeakerLabel("L2", long), `L${SPEAKER_MERGE_MAX_DEPTH + 2}`);
  const segments: TranscriptSegment[] = [
    { speaker: "A", text: "one", startSec: 0, endSec: 1 },
    { speaker: "C", text: "two", startSec: 1, endSec: 3 },
    { speaker: "D", text: "three", startSec: 3, endSec: 4 },
    { speaker: "B", text: "four", startSec: 4, endSec: 6 },
  ];
  assert.equal(transcriptText(segments, speakers), "Casey: one\nCasey: two\nD: three\nCasey: four");
  assert.deepEqual(resolvedSpeakerLabels(segments, speakers), ["C", "D"]);
  const shown = displaySegments(segments, speakers);
  assert.deepEqual(
    speakerTurns(shown).map((turn) => [turn.label, turn.indexes]),
    [
      ["C", [0, 1]],
      ["D", [2]],
      ["C", [3]],
    ],
    "consecutive segments resolving to one speaker form one turn",
  );
  assert.equal(displaySegments(segments, []), segments, "no combines: the same array, no copies");
  const stats = speakerStats(segments, speakers);
  assert.deepEqual(stats.resolved.get("C"), { time: 5, count: 3, first: 0 });
  assert.deepEqual(stats.mergedUnder.get("C"), ["A", "B"]);
  assert.equal(stats.raw.get("A")?.time, 1);
}

// --- Suggestions on the fixtures ------------------------------------------
{
  assert.equal(normalizeSpeakerKey(" speaker_03 "), normalizeSpeakerKey("SPEAKER_03"));
  assert.notEqual(normalizeSpeakerKey("SPEAKER_04"), normalizeSpeakerKey("SPEAKER_01"));
  const oversplit = parseTimedTranscript("board-meeting.oversplit.whisperx.json", oversplitJson);
  // The server trims labels on import, as the parser already does.
  const imported = oversplit.segments.map((segment) => ({ ...segment, speaker: segment.speaker.trim() }));
  assert.ok(needsSpeakerReview(imported));
  const labels = resolvedSpeakerLabels(imported);
  assert.deepEqual(labels, [
    "SPEAKER_00",
    "SPEAKER_01",
    "SPEAKER_02",
    "SPEAKER_04",
    "SPEAKER_03",
    "speaker_03",
  ]);
  const talkTime = new Map([...speakerStats(imported).resolved].map(([label, row]) => [label, row.time]));
  const suggestions = speakerSuggestions({ labels, speakers: [], attendees: demoAttendees, talkTime });
  assert.deepEqual(
    suggestions.map((item) => (item.kind === "combine" ? [item.kind, item.label, item.into] : [item.kind])),
    [["combine", "speaker_03", "SPEAKER_03"]],
    "only the case/spacing variant is suggested; SPEAKER_04 needs a person to decide",
  );
  assert.deepEqual(combineGroups(suggestions), [{ into: "SPEAKER_03", from: ["speaker_03"] }]);
  // A named label wins as the target even with less talk time.
  const namedFirst = speakerSuggestions({
    labels,
    speakers: [{ label: "speaker_03", name: "Avery Santos" }],
    attendees: demoAttendees,
    talkTime,
  });
  assert.deepEqual(
    namedFirst.find((item) => item.kind === "combine"),
    {
      kind: "combine",
      id: "combine:SPEAKER_03",
      label: "SPEAKER_03",
      into: "speaker_03",
      reason: "Same label apart from case or spacing",
    },
  );
  // Once combined, nothing more is suggested for those labels.
  const afterCombine = [{ label: "speaker_03", mergedInto: "SPEAKER_03" }];
  assert.deepEqual(
    speakerSuggestions({
      labels: resolvedSpeakerLabels(imported, afterCombine),
      speakers: afterCombine,
      attendees: demoAttendees,
    }),
    [],
  );

  const teams = parseTimedTranscript("board-meeting.teams.vtt", teamsVtt);
  const teamLabels = resolvedSpeakerLabels(teams.segments);
  assert.deepEqual(teamLabels, ["Mina Patel", "Jordan Lee", "Devon Clarke", "Avery Santos"]);
  assert.ok(needsSpeakerReview(teams.segments), "four voices still get a review");
  const assigns = speakerSuggestions({ labels: teamLabels, speakers: [], attendees: demoAttendees });
  assert.deepEqual(
    assigns.map((item) => (item.kind === "assign" ? [item.label, item.name, item.personId] : [item.kind])),
    [
      ["Mina Patel", "Mina Patel", "person-mina"],
      ["Jordan Lee", "Jordan Lee", "person-jordan"],
      ["Devon Clarke", "Devon Clarke", undefined],
      ["Avery Santos", "Avery Santos", "person-avery"],
    ],
  );
  // Case-insensitive names, unique first names, and labels already assigned are skipped.
  const loose = speakerSuggestions({
    labels: ["mina patel", "Jordan", "Sam", "SPEAKER_00"],
    speakers: [{ label: "SPEAKER_00", name: "Devon Clarke" }],
    attendees: [...demoAttendees, { name: "Sam Wu" }, { name: "Sam Ode" }],
  });
  assert.deepEqual(
    loose.map((item) => (item.kind === "assign" ? `${item.label}=${item.name}` : item.id)),
    ["mina patel=Mina Patel", "Jordan=Jordan Lee"],
    "an ambiguous first name (two Sams) is not suggested",
  );
  // A label matching an attendee who already has a label is suggested to combine into it.
  const owned = speakerSuggestions({
    labels: ["SPEAKER_00", "Mina", "Mina Patel"],
    speakers: [{ label: "SPEAKER_00", name: "Mina Patel", personId: "person-mina" }],
    attendees: demoAttendees,
    talkTime: new Map([
      ["Mina", 1],
      ["Mina Patel", 9],
    ]),
  });
  assert.deepEqual(
    owned.map((item) => (item.kind === "combine" ? `${item.label}->${item.into}` : item.id)),
    ["Mina->SPEAKER_00", "Mina Patel->SPEAKER_00"],
  );
  const twoForOne = speakerSuggestions({
    labels: ["Mina", "Mina Patel"],
    speakers: [],
    attendees: demoAttendees,
    talkTime: new Map([
      ["Mina", 1],
      ["Mina Patel", 9],
    ]),
  });
  assert.deepEqual(
    twoForOne.map((item) =>
      item.kind === "combine" ? `${item.label}->${item.into}` : `${item.label}=${item.name}`,
    ),
    ["Mina->Mina Patel", "Mina Patel=Mina Patel"],
  );
  assert.equal(
    needsSpeakerReview([{ speaker: "Jo", text: "x", startSec: 0, endSec: 1 }]),
    false,
    "one named speaker needs no review",
  );
  assert.equal(needsSpeakerReview([{ speaker: "SPEAKER_00", text: "x", startSec: 0, endSec: 1 }]), true);
}

// --- Meeting source files: timed offer --------------------------------------
{
  const vtt = await timedTranscriptOffer(new File([teamsVtt], "board-meeting.teams.vtt"));
  assert.equal(vtt?.provider, "vtt");
  assert.equal(vtt?.segments.length, 6);
  const json = await timedTranscriptOffer(new File([oversplitJson], "board.whisperx.json"));
  assert.equal(json?.provider, "whisper-json");
  assert.equal(
    await timedTranscriptOffer(new File(["hello"], "notes.txt")),
    null,
    "plain text: paged import only",
  );
  assert.equal(await timedTranscriptOffer(new File(["audio"], "board.m4a")), null);
  assert.equal(
    await timedTranscriptOffer(new File(['{"meta":1}'], "info.json")),
    null,
    "unparseable: no offer",
  );
  const huge = {
    name: "huge.vtt",
    size: 16 * 1024 * 1024 + 1,
    text: async () => teamsVtt,
  } as unknown as File;
  assert.equal(await timedTranscriptOffer(huge), null, "over 16 MB: no offer, and it is never read");
  const zip = new StreamingZipWriter();
  await zip.add("export/readme.txt", new TextEncoder().encode("Whisper export"));
  await zip.add("export/info.json", new TextEncoder().encode('{"meta":1}'));
  await zip.add("export/board.vtt", new TextEncoder().encode(teamsVtt));
  await zip.add("export/board.json", new TextEncoder().encode(oversplitJson));
  await zip.add("__MACOSX/export/._board.json", new TextEncoder().encode("junk"));
  const archive = new File([zip.finish()], "whisper-export.zip");
  const fromZip = await timedTranscriptOffer(archive);
  assert.equal(fromZip?.fileName, "export/board.json", "JSON first (speakers and words), skipping metadata");
  assert.equal(fromZip?.segments.length, 10);
  const vttOnly = new StreamingZipWriter();
  await vttOnly.add("captions.vtt", new TextEncoder().encode(teamsVtt));
  assert.equal((await timedTranscriptOffer(new File([vttOnly.finish()], "c.zip")))?.provider, "vtt");
  assert.equal(await timedTranscriptOffer(new File(["not a zip at all, long enough"], "bad.zip")), null);
  assert.equal(REPLACE_TRANSCRIPT_CONFIRM.confirmLabel, "Replace transcript");
}

// --- Mutations on both portable adapters -------------------------------------
assert.equal(actionPermission("transcripts:unmergeSpeaker", "mutation"), "meetings:write");
assert.equal(actionPermission("transcripts:mergeSpeakers", "mutation"), "meetings:write");
type Row = { text: string; segments: TranscriptSegment[]; speakers?: TranscriptSpeaker[] };
for (const local of [false, true]) {
  const societyId = "speaker-test";
  const seed = {
    ...portableTestSeed(societyId),
    meetings: [
      { _id: "meeting", societyId },
      { _id: "foreign-meeting", societyId: "foreign" },
    ],
    minutes: [{ _id: "minutes", societyId, meetingId: "meeting", draftTranscript: "before" }],
    users: [
      ...portableTestSeed(societyId).users,
      { _id: "viewer", societyId, role: "Viewer", status: "Active", authSubject: "viewer" },
    ],
  };
  const db = local ? new LocalStoreDb(new MemoryRowStore(seed)) : new MemoryDb({ seed });
  let principal: PortablePrincipal = portableTestPrincipal();
  const runtime = new PortableRuntime({
    db,
    capabilities: makeCapabilities({}),
    principalProvider: () => principal,
  }).registerAll(PORTABLE_FUNCTIONS);
  const base = { societyId, meetingId: "meeting" };
  const read = () => runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting" });
  const merge = (from: string | string[], to: string) =>
    runtime.runMutation("transcripts:mergeSpeakers", { ...base, from, to });
  const unmerge = (label: string) => runtime.runMutation("transcripts:unmergeSpeaker", { ...base, label });
  const draft = async () => String((await db.get("minutes"))?.draftTranscript);

  await runtime.runMutation("transcripts:importTimed", {
    ...base,
    ...parseTimedTranscript("oversplit.json", oversplitJson),
  });
  const imported = await read();
  assert.ok(
    imported.segments.some((segment) => segment.speaker === "speaker_03"),
    "labels are trimmed",
  );
  await runtime.runMutation("transcripts:assignSpeaker", {
    ...base,
    label: "SPEAKER_01",
    name: "Jordan Lee",
  });
  await runtime.runMutation("transcripts:assignSpeaker", { ...base, label: "SPEAKER_04", name: "Jo" });

  // Round trip: combine, then unmerge restores the row's text and speaker map exactly.
  const before = await read();
  assert.deepEqual(await merge("SPEAKER_04", "SPEAKER_01"), { wordsDropped: false });
  const merged = await read();
  assert.deepEqual(merged.segments, before.segments, "segments are untouched");
  assert.match(merged.text, /^Jordan Lee: Seconded\./m, "text regenerates with the resolved name");
  assert.doesNotMatch(merged.text, /^Jo:/m);
  assert.equal(await draft(), merged.text, "the unapproved minutes draft follows");
  await runtime.runMutation("transcripts:assignSpeaker", { ...base, label: "SPEAKER_04", name: "Joanne" });
  assert.equal(
    (await read()).speakers?.find((speaker) => speaker.label === "SPEAKER_04")?.mergedInto,
    "SPEAKER_01",
    "renaming a combined label keeps the combine",
  );
  await runtime.runMutation("transcripts:assignSpeaker", { ...base, label: "SPEAKER_04", name: "Jo" });
  assert.deepEqual(await unmerge("SPEAKER_04"), { wordsDropped: false });
  const restored = await read();
  assert.equal(restored.text, before.text);
  assert.deepEqual(
    restored.speakers?.find((speaker) => speaker.label === "SPEAKER_04"),
    { label: "SPEAKER_04", name: "Jo" },
    "unmerge keeps the label's own name",
  );
  assert.equal(await draft(), before.text);
  await assert.rejects(() => unmerge("SPEAKER_04"), /not combined/);
  await assert.rejects(() => unmerge("SPEAKER_00"), /not combined/);

  // Several labels into one target in one step; an unnamed source leaves no entry behind on unmerge.
  await merge(["SPEAKER_04", "speaker_03", "speaker_03"], "SPEAKER_01");
  const multi = await read();
  assert.deepEqual(resolvedSpeakerLabels(multi.segments, multi.speakers), [
    "SPEAKER_00",
    "SPEAKER_01",
    "SPEAKER_02",
    "SPEAKER_03",
  ]);
  assert.match(multi.text, /^Jordan Lee: Action item for me then/m);
  await unmerge("speaker_03");
  assert.equal(
    (await read()).speakers?.find((speaker) => speaker.label === "speaker_03"),
    undefined,
    "an unnamed label that is unmerged drops out of the speaker map",
  );

  // Chains resolve transitively; cycles and self-merges are refused.
  await merge("SPEAKER_01", "SPEAKER_02");
  const chained = await read();
  assert.equal(resolveSpeakerLabel("SPEAKER_04", chained.speakers), "SPEAKER_02");
  assert.match(chained.text, /^SPEAKER_02: Seconded\./m, "SPEAKER_04 → SPEAKER_01 → SPEAKER_02");
  await assert.rejects(() => merge("SPEAKER_02", "SPEAKER_04"), /already combined into SPEAKER_02/);
  await assert.rejects(() => merge("SPEAKER_02", "SPEAKER_01"), /already combined/);
  await assert.rejects(() => merge(["SPEAKER_00", "SPEAKER_02"], "SPEAKER_02"), /different existing/);
  await assert.rejects(() => merge([], "SPEAKER_02"), /different existing/);
  await assert.rejects(() => merge("missing", "SPEAKER_02"), /different existing/);
  // Merging into a combined label points at its final target.
  await merge("SPEAKER_00", "SPEAKER_04");
  assert.equal(
    (await read()).speakers?.find((speaker) => speaker.label === "SPEAKER_00")?.mergedInto,
    "SPEAKER_02",
  );
  await unmerge("SPEAKER_00");
  await unmerge("SPEAKER_01");
  const unchained = await read();
  assert.equal(
    resolveSpeakerLabel("SPEAKER_04", unchained.speakers),
    "SPEAKER_01",
    "the inner combine stays",
  );
  await unmerge("SPEAKER_04");

  // A depth beyond the limit is refused.
  const deep: TranscriptSegment[] = Array.from({ length: SPEAKER_MERGE_MAX_DEPTH + 2 }, (_, index) => ({
    speaker: `D${index}`,
    text: `line ${index}`,
    startSec: index,
    endSec: index + 1,
  }));
  await runtime.runMutation("transcripts:importTimed", { ...base, provider: "vtt", segments: deep });
  for (let index = 0; index < SPEAKER_MERGE_MAX_DEPTH; index++) await merge(`D${index}`, `D${index + 1}`);
  await assert.rejects(
    () => merge(`D${SPEAKER_MERGE_MAX_DEPTH}`, `D${SPEAKER_MERGE_MAX_DEPTH + 1}`),
    /too many levels/,
  );

  // Rows merged the old way (segments relabelled, no mergedInto) read as before.
  await runtime.runMutation("transcripts:importTimed", {
    ...base,
    provider: "vtt",
    segments: [
      { speaker: "SPEAKER_01", text: "already relabelled", startSec: 0, endSec: 1 },
      { speaker: "SPEAKER_01", text: "by an old merge", startSec: 1, endSec: 2 },
    ],
  });
  await runtime.runMutation("transcripts:assignSpeaker", { ...base, label: "SPEAKER_01", name: "Jo" });
  const legacy = await read();
  assert.equal(legacy.text, "Jo: already relabelled\nJo: by an old merge");
  await assert.rejects(() => unmerge("SPEAKER_01"), /not combined/);

  // Approved minutes never change.
  await runtime.runMutation("transcripts:importTimed", {
    ...base,
    ...parseTimedTranscript("oversplit.json", oversplitJson),
  });
  await db.transaction(() => db.patch("minutes", { approvedAt: "2026-01-01", draftTranscript: "frozen" }));
  const approved = await db.get("minutes");
  await merge(["SPEAKER_04", "speaker_03"], "SPEAKER_01");
  await unmerge("speaker_03");
  assert.deepEqual(await db.get("minutes"), approved, "merge and unmerge leave approved minutes alone");

  // Ownership and permissions.
  await assert.rejects(
    () =>
      runtime.runMutation("transcripts:unmergeSpeaker", {
        ...base,
        meetingId: "foreign-meeting",
        label: "A",
      }),
    /not found|another|denied/i,
  );
  principal = { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "viewer" };
  await assert.rejects(() => unmerge("SPEAKER_04"), /meetings:write/);
  await assert.rejects(() => merge("SPEAKER_00", "SPEAKER_02"), /meetings:write/);
  principal = portableTestPrincipal();
  assert.equal(
    resolveSpeakerLabel("SPEAKER_04", (await read()).speakers),
    "SPEAKER_01",
    "denied calls change nothing",
  );
}

// Assignment candidates: attendance, expected attendees, committee, directors;
// de-duplicated by directory id, then name; personId kept when known.
{
  const directors = [
    { _id: "d_mina", firstName: "Mina", lastName: "Patel", directoryPersonId: "p_mina", position: "Chair", status: "Active" },
    { _id: "d_jordan", firstName: "Jordan", lastName: "Lee", directoryPersonId: "p_jordan", position: "Treasurer", status: "Active" },
    { _id: "d_old", firstName: "Former", lastName: "Director", status: "Active", termEnd: "2020-01-01" },
    { _id: "d_gone", firstName: "Resigned", lastName: "Director", status: "Resigned" },
  ];
  const members = [{ _id: "m_avery", firstName: "Avery", lastName: "Santos", directoryPersonId: "p_avery" }];
  const rows = speakerCandidates({
    minutes: { detailedAttendance: [{ name: "mina patel", status: "present" }], attendees: ["Guest Speaker", "Mina Patel"] },
    attendeeIds: ["d_jordan", "m_avery", "Casey Wong", "k17abcd0123unresolved"],
    committeeMembers: [
      { name: "Jordan Lee", role: "Member", directorId: "d_jordan" },
      { name: "Riley Chen", role: "Chair", personId: "p_riley" },
      { name: "Left Member", role: "Member", leftAt: "2025-01-01" },
    ],
    directors,
    members,
    todayISO: "2026-11-01",
  });
  assert.deepEqual(
    rows.map((row) => [row.name, row.group, row.personId ?? null]),
    [
      ["mina patel", "Attended", "p_mina"],
      ["Guest Speaker", "Attended", null],
      ["Jordan Lee", "Expected", "p_jordan"],
      ["Avery Santos", "Expected", "p_avery"],
      ["Casey Wong", "Expected", null],
      ["Riley Chen", "Committee", "p_riley"],
    ],
    "ordered by source, de-duplicated, unresolved ids and past members/directors left out, directory ids filled in",
  );
  assert.equal(rows[0].roleTitle, "Chair", "a later duplicate fills in the role");
  assert.equal(showCandidateGroups(rows), false, "short lists are not grouped");
  const notesMeeting = speakerCandidates({ directors, todayISO: "2026-11-01" });
  assert.deepEqual(notesMeeting.map((row) => row.name), ["Mina Patel", "Jordan Lee"], "no attendance: the directors are offered");
  assert.equal(
    showCandidateGroups(speakerCandidates({ minutes: { attendees: ["A One", "B Two", "C Three", "D Four", "E Five"] }, directors, todayISO: "2026-11-01" })),
    true,
    "long mixed lists are grouped",
  );
}

console.log(
  "Transcript speaker checks passed: resolution, chains, cycles, turns, suggestions on the oversplit and Teams fixtures, the source-file timed offer (including ZIP), and merge/unmerge on both portable adapters with permissions and approved-minutes immutability.",
);
