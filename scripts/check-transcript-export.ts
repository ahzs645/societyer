/**
 * Transcript export (WebVTT, SRT, Whisper JSON): exact formatting, escaping,
 * in-camera redaction, file names, and the round trip export →
 * parseTimedTranscript → transcripts:importTimed with timings, speakers and
 * words intact. Fixtures are small inline copies of
 * /tmp/societyer-transcript/fixture/ (board-meeting.whisperx.json,
 * board-meeting.vtt, board-meeting.teams.vtt), so the check is hermetic.
 */
import assert from "node:assert/strict";
import { parseTimedTranscript } from "../src/features/meetings/transcript/timedTranscript";
import {
  captionTimestamp,
  escapeVttText,
  exportCues,
  exportTranscript,
  toSrt,
  toWebVtt,
  toWhisperJson,
  transcriptExportFileName,
  transcriptExportHint,
  TRANSCRIPT_EXPORT_FORMATS,
  type ExportableTranscript,
  type TranscriptExportFormat,
} from "../shared/transcriptExport";
import {
  IN_CAMERA_TITLE,
  IN_CAMERA_TRANSCRIPT_LINE,
  inCameraExportRanges,
  inCameraRecordingRanges,
} from "../shared/minutesPrivacy";
import { speakerResolver, type TranscriptSegment, type TranscriptSpeaker } from "../shared/transcriptModel";
import { LocalStoreDb, MemoryDb, MemoryRowStore, PortableRuntime, makeCapabilities } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

// --- Inline fixtures ----------------------------------------------------------

const word = (text: string, start: number, end: number, speaker: string) => ({ word: text, start, end, speaker });
const WHISPERX = JSON.stringify({
  language: "en",
  segments: [
    { start: 0, end: 7.051, speaker: "SPEAKER_00", text: " Good evening everyone. I'm calling the meeting to order at seven oh two.",
      words: [word("Good", 0, 0.282, "SPEAKER_00"), word("evening", 0.282, 0.733, "SPEAKER_00"), word("everyone.", 0.733, 1.297, "SPEAKER_00"), word("I'm", 1.297, 1.523, "SPEAKER_00")] },
    { start: 7.651, end: 13.1, speaker: "SPEAKER_01", text: " Thanks. Before we start, I'd like to add the community garden lease to new business.",
      words: [word("Thanks.", 7.651, 8.164, "SPEAKER_01"), word("Before", 8.164, 8.613, "SPEAKER_01"), word("we", 8.613, 8.805, "SPEAKER_01"), word("start,", 8.805, 9.254, "SPEAKER_01")] },
    { start: 13.7, end: 19.431, speaker: "SPEAKER_00", text: " Noted. Next item is the twenty twenty seven operating budget that Marcus circulated last week.",
      words: [word("Noted.", 13.7, 14.123, "SPEAKER_00"), word("Next", 14.123, 14.424, "SPEAKER_00"), word("item", 14.424, 14.726, "SPEAKER_00"), word("is", 14.726, 14.907, "SPEAKER_00")] },
    { start: 20.031, end: 26.652, speaker: "SPEAKER_02", text: " The headline is a small surplus of about four thousand dollars.",
      words: [word("The", 20.031, 20.241, "SPEAKER_02"), word("headline", 20.241, 20.714, "SPEAKER_02"), word("is", 20.714, 20.872, "SPEAKER_02"), word("a", 20.872, 20.977, "SPEAKER_02")] },
    { start: 27.252, end: 30.233, speaker: "SPEAKER_02", text: " I move that we approve the draft budget as circulated.",
      words: [word("I", 27.252, 27.361, "SPEAKER_02"), word("move", 27.361, 27.632, "SPEAKER_02"), word("that", 27.632, 27.903, "SPEAKER_02"), word("we", 27.903, 28.065, "SPEAKER_02")] },
    { start: 30.833, end: 35.132, speaker: "SPEAKER_01", text: " Seconded. I'll note for the minutes that the reserve policy still applies." },
    { start: 35.732, end: 41.238, speaker: "SPEAKER_03", text: " Before we vote, I can take the grant report back to the funder." },
    { start: 41.838, end: 45.87, speaker: "SPEAKER_00", text: " All in favour? Any opposed? The motion carries unanimously." },
    { start: 46.47, end: 50.744, speaker: "SPEAKER_03", text: " Action item for me then: the grant report by November fifteenth." },
  ],
});
const VTT = [
  "WEBVTT",
  "",
  "00:00:00.000 --> 00:00:07.051",
  "<v SPEAKER_00>Good evening everyone. I'm calling the meeting to order at seven oh two.",
  "",
  "00:00:07.651 --> 00:00:13.100",
  "<v SPEAKER_01>Thanks. Before we start, I'd like to add the community garden lease to new business.",
  "",
  "00:00:13.700 --> 00:00:19.431",
  "<v SPEAKER_00>Noted. Next item is the twenty twenty seven operating budget.",
  "",
  "00:00:20.031 --> 00:00:26.652",
  "<v SPEAKER_02>The headline is a small surplus of about four thousand dollars.",
  "",
  "00:00:27.252 --> 00:00:30.233",
  "<v SPEAKER_02>I move that we approve the draft budget as circulated.",
  "",
  "00:00:30.833 --> 00:00:35.132",
  "<v SPEAKER_01>Seconded.",
  "",
].join("\n");
const TEAMS_VTT = [
  "WEBVTT",
  "",
  "0001-cue",
  "00:00:00.000 --> 00:00:07.051",
  "<v Mina Patel>Good evening everyone. I'm calling the meeting to order at seven oh two.</v>",
  "",
  "0002-cue",
  "00:00:07.651 --> 00:00:13.100",
  "<v Jordan Lee>Thanks. Before we start, I'd like to add the community garden lease to new business.</v>",
  "",
  "0003-cue",
  "00:00:13.700 --> 00:00:19.431",
  "<v Mina Patel>Noted. Next item is the operating budget.</v>",
  "",
  "0004-cue",
  "00:00:20.031 --> 00:00:26.652",
  "<v Devon Clarke>The headline is a small surplus.</v>",
  "",
  "0005-cue",
  "00:00:27.252 --> 00:00:30.233",
  "<v Devon Clarke>I move that we approve the draft budget as circulated.</v>",
  "",
  "0006-cue",
  "00:00:30.833 --> 00:00:35.132",
  "<v Jordan Lee>Seconded. I'll note for the minutes that the reserve policy still applies.</v>",
  "",
].join("\r\n");

const fixtures = {
  whisperx: parseTimedTranscript("board-meeting.whisperx.json", WHISPERX),
  vtt: parseTimedTranscript("board-meeting.vtt", VTT),
  teams: parseTimedTranscript("board-meeting.teams.vtt", TEAMS_VTT),
};
assert.equal(fixtures.whisperx.segments.length, 9);
assert.equal(fixtures.whisperx.segments[0].words?.length, 4);

// --- Round trip ---------------------------------------------------------------

const MS = 0.0005 + 1e-9;
const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= MS, `${what}: ${actual} vs ${expected}`);

/** What a re-import must hold: each segment with the speaker as shown. */
function expected(transcript: ExportableTranscript) {
  const resolver = speakerResolver(transcript.speakers ?? []);
  return transcript.segments.map((segment) => ({ ...segment, speaker: resolver.name(segment.speaker) }));
}

function compare(
  actual: readonly TranscriptSegment[],
  wanted: readonly TranscriptSegment[],
  format: TranscriptExportFormat,
  label: string,
) {
  assert.equal(actual.length, wanted.length, `${label} ${format}: segment count`);
  actual.forEach((segment, index) => {
    const want = wanted[index];
    const at = `${label} ${format} #${index}`;
    assert.equal(segment.speaker, want.speaker, `${at}: speaker`);
    assert.equal(segment.text, want.text, `${at}: text`);
    near(segment.startSec, want.startSec, `${at}: start`);
    // Caption cues must end after they start, so a zero-length line gains a millisecond.
    near(segment.endSec, format === "json" ? want.endSec : Math.max(want.endSec, want.startSec + 0.001), `${at}: end`);
    if (format === "json") {
      assert.equal(segment.words?.length ?? 0, want.words?.length ?? 0, `${at}: words`);
      segment.words?.forEach((w, i) => {
        assert.equal(w.text, want.words![i].text, `${at}: word ${i}`);
        near(w.startSec, want.words![i].startSec, `${at}: word ${i} start`);
        near(w.endSec, want.words![i].endSec, `${at}: word ${i} end`);
      });
    } else {
      assert.equal(segment.words, undefined, `${at}: captions carry no word timings`);
    }
  });
}

function roundTrip(transcript: ExportableTranscript, label: string) {
  for (const { id } of TRANSCRIPT_EXPORT_FORMATS) {
    const file = exportTranscript(transcript, id, { title: "Board meeting", date: "2026-10-06" });
    assert.equal(file.fileName, `board-meeting-2026-10-06.${id}`);
    assert.equal(file.tooLargeToImport, false);
    const parsed = parseTimedTranscript(file.fileName, file.content);
    assert.equal(parsed.provider, id === "json" ? "whisper-json" : id);
    compare(parsed.segments, expected(transcript), id, label);
  }
}

for (const [name, parsed] of Object.entries(fixtures)) roundTrip({ segments: parsed.segments }, name);

// Assigned names and combined speakers export as shown (SPEAKER_02 combined into SPEAKER_01).
const named: TranscriptSpeaker[] = [
  { label: "SPEAKER_00", name: "Mina Patel" },
  { label: "SPEAKER_01", name: "Jordan Lee" },
  { label: "SPEAKER_02", name: "Devon Clarke", mergedInto: "SPEAKER_01" },
  { label: "SPEAKER_03", name: "Avery Santos" },
];
const namedTranscript = { segments: fixtures.whisperx.segments, speakers: named };
roundTrip(namedTranscript, "named+merged");
const namedCues = exportCues(namedTranscript);
assert.deepEqual(
  [...new Set(namedCues.map((cue) => cue.speaker))],
  ["Mina Patel", "Jordan Lee", "Avery Santos"],
  "the combined label takes its target's name",
);
// An unnamed label keeps its raw label; a chain resolves transitively.
const chained = exportCues({
  segments: fixtures.vtt.segments,
  speakers: [{ label: "SPEAKER_00", mergedInto: "SPEAKER_02" }, { label: "SPEAKER_02", mergedInto: "SPEAKER_01" }],
});
assert.deepEqual([...new Set(chained.map((cue) => cue.speaker))], ["SPEAKER_01"]);

// Escaping: `&`, `<`, `>` in text and voice names, `-->` in text, and a zero-length line.
const tricky: ExportableTranscript = {
  segments: [
    { speaker: "R&D <Team>", text: "If a < b && c > d --> then &lt; stays literal.", startSec: 1, endSec: 2 },
    { speaker: "R&D <Team>", text: "Tags like <b>bold</b> are text, not markup.", startSec: 2, endSec: 2 },
    { speaker: "Ms Lee", text: "Note: a colon after the first word is fine.", startSec: 3600 + 62.5, endSec: 3600 + 65 },
    { speaker: "Ms Lee", text: "Second line keeps the prefix repeated.", startSec: 3666, endSec: 3667.25 },
  ],
};
const trickyVtt = toWebVtt(exportCues(tricky));
assert.ok(trickyVtt.includes("<v R&amp;D &lt;Team&gt;>If a &lt; b &amp;&amp; c &gt; d --&gt; then &amp;lt; stays literal."));
assert.ok(!/-->\s*then/.test(trickyVtt), "cue text never holds -->");
assert.ok(trickyVtt.includes("00:00:02.000 --> 00:00:02.001\n"), "zero-length cue gains a millisecond");
compare(parseTimedTranscript("t.vtt", trickyVtt).segments, expected(tricky), "vtt", "tricky");
compare(parseTimedTranscript("t.json", toWhisperJson(exportCues(tricky))).segments, expected(tricky), "json", "tricky");

// --- Exact formatting ---------------------------------------------------------

assert.equal(captionTimestamp(0, "."), "00:00:00.000");
assert.equal(captionTimestamp(7.051, "."), "00:00:07.051");
assert.equal(captionTimestamp(3723.4566, ","), "01:02:03,457");
assert.equal(captionTimestamp(59.9996, "."), "00:01:00.000", "rounding carries into the next minute");
assert.equal(captionTimestamp(100 * 3600 + 1, "."), "100:00:01.000", "hours grow past 99");
assert.equal(escapeVttText("a&b<c>d"), "a&amp;b&lt;c&gt;d");

const small: ExportableTranscript = {
  segments: [
    { speaker: "SPEAKER_00", text: "Call to order.", startSec: 0, endSec: 1.5, words: [{ text: "Call", startSec: 0, endSec: 0.4 }, { text: "to", startSec: 0.4, endSec: 0.6 }, { text: "order.", startSec: 0.6, endSec: 1.5 }] },
    { speaker: "SPEAKER_01", text: "Seconded.", startSec: 3661.25, endSec: 3662.0004 },
  ],
  speakers: [{ label: "SPEAKER_00", name: "Mina Patel" }],
  language: "en",
};
const smallCues = exportCues(small);

// --- Menu hints: "word timings" only when the transcript has them --------------

assert.equal(transcriptExportHint("json", small), "Includes word timings");
assert.equal(transcriptExportHint("json", { segments: small.segments.slice(1) }), "Segments with timings", "no words: no word-timings promise");
assert.equal(transcriptExportHint("json", { segments: [{ ...small.segments[1], words: [] }] }), "Segments with timings", "an empty words[] is no word timings");
assert.equal(transcriptExportHint("vtt", small), "Names and timings");
assert.equal(transcriptExportHint("srt", small), "“Name:” before each line");
assert.equal(
  toWebVtt(smallCues),
  "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\n<v Mina Patel>Call to order.\n\n01:01:01.250 --> 01:01:02.000\n<v SPEAKER_01>Seconded.\n",
);
assert.equal(
  toSrt(smallCues),
  "1\r\n00:00:00,000 --> 00:00:01,500\r\nMina Patel: Call to order.\r\n\r\n2\r\n01:01:01,250 --> 01:01:02,000\r\nSPEAKER_01: Seconded.\r\n",
);
assert.equal(
  toWhisperJson(smallCues, "en"),
  `${JSON.stringify(
    {
      language: "en",
      duration: 3662,
      segments: [
        { id: 0, start: 0, end: 1.5, text: "Call to order.", speaker: "Mina Patel", words: [{ word: "Call", start: 0, end: 0.4 }, { word: "to", start: 0.4, end: 0.6 }, { word: "order.", start: 0.6, end: 1.5 }] },
        { id: 1, start: 3661.25, end: 3662, text: "Seconded.", speaker: "SPEAKER_01" },
      ],
    },
    null,
    2,
  )}\n`,
);
assert.ok(!toWhisperJson(smallCues).includes('"text": "Call to order. Seconded."'), "no top-level text: source uploads keep speakers");
assert.ok(!exportTranscript(small, "vtt").content.startsWith("﻿"), "no byte order mark");
assert.equal(exportTranscript(small, "json").mime, "application/json;charset=utf-8");

// SRT limitation (documented): a prefix counts as a speaker only when it looks like a name and repeats.
const once = parseTimedTranscript(
  "once.srt",
  toSrt(exportCues({ segments: [
    { speaker: "Mina Patel", text: "One.", startSec: 0, endSec: 1 },
    { speaker: "Mina Patel", text: "Two.", startSec: 1, endSec: 2 },
    { speaker: "Dr. Lee", text: "Three.", startSec: 2, endSec: 3 },
  ] })),
);
assert.deepEqual(once.segments.map((segment) => [segment.speaker, segment.text]), [
  ["Mina Patel", "One."],
  ["Mina Patel", "Two."],
  ["Speaker", "Dr. Lee: Three."],
]);

// --- File names ---------------------------------------------------------------

assert.equal(transcriptExportFileName("Board meeting — 2026-10-06", "2026-10-06", "vtt"), "board-meeting-2026-10-06.vtt");
assert.equal(transcriptExportFileName("AGM 2025: budget / elections?", "2025-06-14", "srt"), "agm-2025-budget-elections-2025-06-14.srt");
assert.equal(transcriptExportFileName("Réunion du CA ✨", "2026-01-02", "json"), "réunion-du-ca-2026-01-02.json");
assert.equal(transcriptExportFileName("../../etc/passwd", undefined, "vtt"), "etc-passwd.vtt");
assert.equal(transcriptExportFileName("", "2026-10-06", "json"), "meeting-transcript-2026-10-06.json");
assert.equal(transcriptExportFileName(undefined, "not a date", "vtt"), "meeting-transcript.vtt");
assert.ok(transcriptExportFileName("x".repeat(300), "2026-10-06", "vtt").length <= 80 + 15);

// --- In camera ----------------------------------------------------------------

const session = (title: string, range?: [number, number]) => ({
  type: "in_camera",
  title,
  ...(range ? { recordingStartSec: range[0], recordingEndSec: range[1] } : {}),
});
// No in-camera session: nothing to cut, nothing to warn about.
assert.deepEqual(inCameraExportRanges({ sessionSegments: [{ type: "public", title: "Open" }] }), { ranges: [], unmarked: [] });
assert.deepEqual(inCameraExportRanges(null), { ranges: [], unmarked: [] });

const marked = { sessionSegments: [session("Personnel", [20, 30.5])] };
assert.deepEqual(inCameraExportRanges(marked), { ranges: [{ title: "Personnel", startSec: 20, endSec: 30.5 }], unmarked: [] });
assert.deepEqual(inCameraExportRanges(marked).ranges, inCameraRecordingRanges(marked), "agrees with the reader rule when all are marked");

const partly = {
  sessionSegments: [session("Personnel", [20, 30.5]), session("Legal advice")],
  sections: [{ title: "Land deal", type: "in_camera" }, { title: "Personnel", type: "in_camera" }, { title: "Sub", type: "in_camera", depth: 1 }],
};
assert.equal(inCameraRecordingRanges(partly), null);
assert.deepEqual(inCameraExportRanges(partly), {
  ranges: [{ title: "Personnel", startSec: 20, endSec: 30.5 }],
  unmarked: ["Legal advice", "Land deal"],
});
// An in-camera section with no session at all, and approved minutes' adopted snapshot.
assert.deepEqual(inCameraExportRanges({ sections: [{ title: "Closed", type: "closed_session" }] }), { ranges: [], unmarked: ["Closed"] });
assert.deepEqual(
  inCameraExportRanges({ approvedAt: "2026-10-07", sessionSegments: [session("Personnel", [20, 30.5])], adoptedSnapshot: { sessionSegments: [session("Personnel"), session("Audit", [40, 45])] } }),
  { ranges: [{ title: "Personnel", startSec: 20, endSec: 30.5 }, { title: "Audit", startSec: 40, endSec: 45 }], unmarked: ["Personnel"] },
);
// In camera but nothing names a session (only a sub-item): still warns.
assert.deepEqual(inCameraExportRanges({ sections: [{ title: "Item", type: "in_camera", depth: 1 }] }), { ranges: [], unmarked: [IN_CAMERA_TITLE] });
for (const minutes of [marked, partly, { sections: [{ title: "Closed", type: "closed_session" }] }])
  assert.equal(inCameraExportRanges(minutes).unmarked.length === 0, inCameraRecordingRanges(minutes) !== null);

// Segments 20.031–26.652 and 27.252–30.233 overlap 20–30.5: one placeholder cue replaces both.
for (const { id } of TRANSCRIPT_EXPORT_FORMATS) {
  const file = exportTranscript(namedTranscript, id, { title: "Board", date: "2026-10-06", inCameraRanges: inCameraExportRanges(marked).ranges });
  assert.equal(file.inCameraCount, 1);
  assert.equal(file.cueCount, namedTranscript.segments.length - 1);
  assert.ok(!file.content.includes("surplus") && !file.content.includes("approve the draft budget"), `${id}: in-camera words are gone`);
  const parsed = parseTimedTranscript(file.fileName, file.content).segments;
  const placeholder = parsed.find((segment) => segment.text === IN_CAMERA_TRANSCRIPT_LINE);
  assert.ok(placeholder, `${id}: placeholder cue`);
  near(placeholder.startSec, 20.031, `${id}: placeholder start`);
  near(placeholder.endSec, 30.233, `${id}: placeholder end`);
  assert.equal(placeholder.words, undefined);
  // Voices carry the placeholder's speaker; SRT keeps the cue text alone.
  assert.equal(placeholder.speaker, id === "srt" ? "Speaker" : IN_CAMERA_TITLE);
  assert.equal(parsed.filter((segment) => segment.speaker === "Mina Patel").length, 3, `${id}: other speakers stay`);
}
const srtPlaceholder = exportTranscript(namedTranscript, "srt", { inCameraRanges: inCameraExportRanges(marked).ranges }).content;
assert.ok(srtPlaceholder.includes(`\r\n${IN_CAMERA_TRANSCRIPT_LINE}\r\n`), "the SRT placeholder line has no name prefix");
// Included: in-camera parts stay word for word.
assert.ok(exportTranscript(namedTranscript, "vtt", { inCameraRanges: [] }).content.includes("surplus"));

// --- Through transcripts:importTimed on both portable adapters ---------------

for (const local of [false, true]) {
  const societyId = "export-test";
  const seed = {
    ...portableTestSeed(societyId),
    meetings: [{ _id: "desktop-meeting", societyId }, { _id: "hosted-meeting", societyId }],
  };
  const db = local ? new LocalStoreDb(new MemoryRowStore(seed)) : new MemoryDb({ seed });
  const runtime = new PortableRuntime({
    db,
    capabilities: makeCapabilities({}),
    principalProvider: () => portableTestPrincipal(),
  }).registerAll(PORTABLE_FUNCTIONS);
  type Row = { segments: TranscriptSegment[]; speakers?: TranscriptSpeaker[]; provider: string };
  const read = (meetingId: string) => runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId });
  // Made "on the desktop": imported, named and combined there.
  const desktop = { societyId, meetingId: "desktop-meeting" };
  await runtime.runMutation("transcripts:importTimed", { ...desktop, ...fixtures.whisperx, provider: "local-whisper" });
  for (const speaker of named.filter((entry) => entry.name))
    await runtime.runMutation("transcripts:assignSpeaker", { ...desktop, label: speaker.label, name: speaker.name });
  await runtime.runMutation("transcripts:mergeSpeakers", { ...desktop, from: "SPEAKER_02", to: "SPEAKER_01" });
  const source = await read("desktop-meeting");
  for (const { id } of TRANSCRIPT_EXPORT_FORMATS) {
    const file = exportTranscript(source, id, { title: "Board meeting", date: "2026-10-06" });
    const parsed = parseTimedTranscript(file.fileName, file.content);
    // Uploaded "on the hosted site".
    await runtime.runMutation("transcripts:importTimed", { societyId, meetingId: "hosted-meeting", ...parsed });
    const hosted = await read("hosted-meeting");
    assert.equal(hosted.provider, parsed.provider);
    compare(hosted.segments, expected(source), id, `importTimed ${local ? "local" : "memory"}`);
  }
}

console.log("Transcript export checks passed.");
