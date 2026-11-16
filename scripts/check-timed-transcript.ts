import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseTimedTranscript } from "../src/features/meetings/transcript/timedTranscript";
import { computePeaks, WAVEFORM_FILE_LIMIT } from "../src/features/meetings/transcript/waveform";
import {
  activeIndex,
  activeWordIndex,
  formatTranscriptTime,
} from "../src/features/meetings/transcript/activeIndex";
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
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import type { TranscriptSegment } from "../shared/transcriptModel";
import { inCameraDividerLabel } from "../src/features/meetings/transcript/InCameraTranscript";

const vtt = parseTimedTranscript(
  "meeting.vtt",
  [
    "\uFEFFWEBVTT",
    "",
    "NOTE ignore",
    "00:00.000 --> 00:01.000",
    "ignored",
    "",
    "STYLE",
    "::cue { color: red }",
    "",
    "cue-1",
    "00:01.000 --> 00:03.500 align:start position:10%",
    "<v.Alex Alex Smith> Hello <b>everyone</b> &amp; welcome.",
    "",
    "00:00:04.000 --> 00:00:06.000",
    "Jo: Thank   you.",
    "",
    "00:00:07.000 --> 00:00:08.000",
    "Jo: Another cue.",
    "",
  ].join("\r\n"),
);
assert.equal(vtt.provider, "vtt");
assert.deepEqual(vtt.segments, [
  { speaker: "Alex Smith", text: "Hello everyone & welcome.", startSec: 1, endSec: 3.5 },
  { speaker: "Jo", text: "Thank you.", startSec: 4, endSec: 6 },
  { speaker: "Jo", text: "Another cue.", startSec: 7, endSec: 8 },
]);
assert.equal(vtt.durationSeconds, 8);
const srt = parseTimedTranscript(
  "recording.SRT",
  "1\n00:01:02,125 --> 00:01:04,500\nSam: First line\nsecond line\n\n2\n00:01:05,000 --> 00:01:06,000\n<v Lee>Next\n",
);
assert.equal(srt.provider, "srt");
assert.deepEqual(srt.segments[0], {
  speaker: "Speaker",
  text: "Sam: First line second line",
  startSec: 62.125,
  endSec: 64.5,
});
assert.equal(srt.segments[1].speaker, "Lee");
const whisper = parseTimedTranscript(
  "whisper.json",
  JSON.stringify({
    segments: [
      {
        start: 0,
        end: 2,
        text: " Hello world. ",
        speaker: "SPEAKER_00",
        words: [
          { word: " Hello", start: 0, end: 0.5 },
          { text: "world.", start: 0.7, end: 2 },
        ],
      },
      { start: 3, end: 4, text: "Yes", words: [{ word: "Yes", speaker: "SPEAKER_01" }] },
    ],
  }),
);
assert.equal(whisper.provider, "whisper-json");
assert.equal(whisper.segments[0].words?.[0].text, "Hello");
assert.equal(whisper.segments[1].speaker, "SPEAKER_01");
assert.equal(whisper.segments[1].words, undefined, "missing word times drop all words for that segment");
assert.equal(whisper.durationSeconds, 4);
assert.throws(() => parseTimedTranscript("x.json", "{}"), /segments/);
assert.throws(
  () => parseTimedTranscript("x.json", '{"segments":[{"start":-1,"end":2,"text":"x"}]}'),
  /times/,
);
assert.throws(() => parseTimedTranscript("x.json", '{"segments":[{"start":2,"end":1,"text":"x"}]}'), /times/);
assert.equal(
  parseTimedTranscript(
    "x.json",
    '{"segments":[{"start":0,"end":1,"text":"x","words":[{"word":"x","start":0,"end":2}]}]}',
  ).segments[0].words?.[0].endSec,
  1,
);
assert.throws(() => parseTimedTranscript("x.vtt", "WEBVTT\n\n00:99.000 --> 01:00.000\nx"), /timestamp/);
assert.throws(() => parseTimedTranscript("x.vtt", "WEBVTT\n\nNOTE no cues"), /segments/);
assert.throws(() => parseTimedTranscript("x.docx", "hello"), /Choose/);
assert.throws(() => parseTimedTranscript("x.txt", "hello"), /no timestamps/);
assert.throws(() => parseTimedTranscript("x.json", " ".repeat(16 * 1024 * 1024 + 1)), /16 MB/);
assert.throws(
  () =>
    parseTimedTranscript(
      "x.json",
      JSON.stringify({ segments: Array.from({ length: 20_001 }, () => ({ start: 0, end: 1, text: "a" })) }),
    ),
  /20,000/,
);
// Real exports: stable sorting, empty alignment artifacts, and boundary drift.
const messy = parseTimedTranscript(
  "whisperx.json",
  JSON.stringify({
    segments: [
      {
        start: 4,
        end: 6,
        text: "later",
        words: [
          { word: "end", start: 6.1, end: 6.2 },
          { word: "first", start: 3.9, end: 4.2 },
          { word: "", start: 4.1, end: 4.3 },
          { word: "middle", start: 4.5, end: 5 },
          { word: "unaligned" },
        ],
      },
      { start: 1, end: 3, text: "first" },
      { start: 1, end: 2, text: "equal-start stays second" },
      { start: 0, end: 1, text: "  " },
    ],
  }),
);
assert.deepEqual(
  messy.segments.map((segment) => segment.text),
  ["first", "equal-start stays second", "later"],
);
assert.deepEqual(messy.segments[2].words, [
  { text: "first", startSec: 4, endSec: 4.2 },
  { text: "middle", startSec: 4.5, endSec: 5 },
  { text: "end", startSec: 6, endSec: 6 },
]);
for (const time of ["-0.1", "1e999"]) {
  assert.throws(
    () =>
      parseTimedTranscript(
        "x.json",
        `{"segments":[{"start":0,"end":2,"text":"x","words":[{"word":"","start":${time},"end":2}]}]}`,
      ),
    /finite|non-negative/,
  );
  assert.throws(
    () => parseTimedTranscript("x.json", `{"segments":[{"start":${time},"end":2,"text":""}]}`),
    /finite|non-negative/,
  );
}
assert.throws(
  () => parseTimedTranscript("x.json", '{"segments":[{"start":0,"end":1,"text":"  "}]}'),
  /segments/,
);
for (const extension of ["vtt", "srt"]) {
  const sorted = parseTimedTranscript(
    `teams.${extension}`,
    "00:02.000 --> 00:04.000\nlater\n\n00:01.000 --> 00:03.000\nfirst\n\n00:01.000 --> 00:02.000\nequal-start\n",
  );
  assert.deepEqual(
    sorted.segments.map((segment) => segment.text),
    ["first", "equal-start", "later"],
  );
}
function captions(lines: string[]) {
  return lines
    .map(
      (line, index) =>
        `00:${String(index).padStart(2, "0")}.000 --> 00:${String(index + 1).padStart(2, "0")}.000\n${line}`,
    )
    .join("\n\n");
}
const prefixes = parseTimedTranscript(
  "prefixes.vtt",
  captions([
    "<v Alex>Motion: this remains the caption text",
    "Motion: to approve the budget",
    "Note: the budget needs review",
    "Jo: first contribution",
    "Jo: second contribution",
    "10: a time reference",
    "Dr. Jo: punctuation is ambiguous",
    "One Two Three Four Five: too many words",
    `${"A".repeat(41)}: too long`,
  ]),
);
assert.deepEqual(
  prefixes.segments.map((segment) => segment.speaker),
  ["Alex", "Speaker", "Speaker", "Jo", "Jo", "Speaker", "Speaker", "Speaker", "Speaker"],
);
assert.equal(prefixes.segments[0].text, "Motion: this remains the caption text");
assert.equal(prefixes.segments[1].text, "Motion: to approve the budget");
assert.equal(
  parseTimedTranscript("fallback.vtt", captions(["Motion: to approve the budget"])).segments[0].speaker,
  "Motion",
  "a file without other speaker evidence retains the prefix fallback",
);
assert.deepEqual(
  parseTimedTranscript(
    "repeated.vtt",
    captions(["Jo: first", "Jo: second", "Motion: to approve the budget"]),
  ).segments.map((segment) => segment.speaker),
  ["Jo", "Jo", "Speaker"],
);
assert.equal(activeIndex(vtt.segments, 0), -1);
assert.equal(activeIndex(vtt.segments, 1), 0);
assert.equal(activeIndex(vtt.segments, 3.8), 0);
assert.equal(activeIndex(vtt.segments, 6), 1);
assert.equal(activeIndex([], 10), -1);
assert.equal(
  activeIndex(
    [
      { startSec: 0, endSec: 10 },
      { startSec: 2, endSec: 3 },
    ],
    4,
  ),
  0,
  "return a containing cue during overlaps",
);
assert.equal(activeIndex(vtt.segments, NaN), -1);
assert.equal(activeWordIndex(whisper.segments[0].words!, 0.6), -1);
assert.equal(activeWordIndex(whisper.segments[0].words!, 0.8), 1);
assert.equal(formatTranscriptTime(3601), "1:00:01");

// A tiny browser-decoder stand-in verifies mixing, max-abs buckets and normalization.
let decodeCount = 0;
const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, "OfflineAudioContext");
Object.defineProperty(globalThis, "OfflineAudioContext", {
  configurable: true,
  value: class {
    async decodeAudioData() {
      decodeCount++;
      const channels = [new Float32Array([0, 0.5, -1, 0]), new Float32Array([0, 0.5, -1, 0])];
      return { numberOfChannels: 2, length: 4, getChannelData: (index: number) => channels[index] };
    }
  },
});
try {
  assert.deepEqual(await computePeaks(new File(["audio"], "test.wav"), 2), new Float32Array([0.5, 1]));
  assert.equal(await computePeaks({ size: WAVEFORM_FILE_LIMIT + 1 } as File), null);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => computePeaks(new File(["audio"], "test.wav"), 2, abort.signal), /abort/i);
  assert.equal(decodeCount, 1, "oversized and aborted files are never decoded");
} finally {
  if (audioDescriptor) Object.defineProperty(globalThis, "OfflineAudioContext", audioDescriptor);
  else Reflect.deleteProperty(globalThis, "OfflineAudioContext");
}

// Run through the actual registry and authorization policy on both portable adapters.
for (const local of [false, true]) {
  const societyId = "transcript-test";
  const seed = {
    ...portableTestSeed(societyId),
    meetings: [
      { _id: "meeting", societyId },
      { _id: "foreign-meeting", societyId: "foreign" },
    ],
    minutes: [{ _id: "minutes", societyId, meetingId: "meeting", draftTranscript: "before" }],
    peopleDirectory: [
      { _id: "person", societyId },
      { _id: "foreign-person", societyId: "foreign" },
    ],
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
  for (const name of ["assignSpeaker", "updateSegment", "importTimed", "mergeSpeakers", "unmergeSpeaker"])
    assert.equal(actionPermission(`transcripts:${name}`, "mutation"), "meetings:write");
  await runtime.runMutation("transcripts:importTimed", { ...base, ...whisper });
  const read = async () =>
    runtime.runQuery<{
      text: string;
      segments: TranscriptSegment[];
      speakers?: { label: string; name?: string; personId?: string; mergedInto?: string }[];
      wordsDropped?: boolean;
    }>("transcripts:getByMeeting", { meetingId: "meeting" });
  assert.equal((await read()).segments[0].words?.length, 2);
  await runtime.runMutation("transcripts:updateSegment", { ...base, index: 0, text: "Hello world." });
  assert.equal((await read()).segments[0].words?.length, 2, "unchanged text preserves word timings");
  await runtime.runMutation("transcripts:assignSpeaker", {
    ...base,
    label: "SPEAKER_00",
    name: "Alex",
    personId: "person",
  });
  assert.match((await read()).text, /^Alex: Hello world\./);
  assert.match(String((await db.get("minutes"))?.draftTranscript), /^Alex:/);
  await runtime.runMutation("transcripts:updateSegment", { ...base, index: 0, speaker: "SPEAKER_01" });
  assert.equal((await read()).segments[0].words?.length, 2, "speaker changes preserve words");
  await runtime.runMutation("transcripts:updateSegment", { ...base, index: 0, text: "Edited words" });
  const updated = await read();
  assert.equal(updated.segments[0].words, undefined);
  assert.equal(updated.segments[0].startSec, 0);
  assert.equal(updated.segments[0].endSec, 2);
  await runtime.runMutation("transcripts:assignSpeaker", { ...base, label: "SPEAKER_00", name: "" });
  assert.equal((await read()).speakers?.find((speaker) => speaker.label === "SPEAKER_00")?.name, undefined);
  await runtime.runMutation("transcripts:importTimed", {
    ...base,
    ...whisper,
    segments: [
      ...whisper.segments,
      { speaker: "SPEAKER_00", text: "Another turn from the same speaker", startSec: 5, endSec: 6 },
    ],
    durationSeconds: 6,
  });
  await runtime.runMutation("transcripts:assignSpeaker", { ...base, label: "SPEAKER_00", name: "Alex" });
  await runtime.runMutation("transcripts:assignSpeaker", {
    ...base,
    label: "SPEAKER_01",
    name: "Jo",
    personId: "person",
  });
  const beforeMerge = await read();
  await runtime.runMutation("transcripts:mergeSpeakers", { ...base, from: "SPEAKER_00", to: "SPEAKER_01" });
  const merged = await read();
  assert.deepEqual(merged.segments, beforeMerge.segments, "a combine keeps every raw segment label");
  assert.deepEqual(
    merged.speakers?.find((speaker) => speaker.label === "SPEAKER_00"),
    { label: "SPEAKER_00", name: "Alex", mergedInto: "SPEAKER_01" },
    "the combine is recorded on the speaker map and keeps the source's own name",
  );
  assert.ok(merged.text.split("\n").every((line) => line.startsWith("Jo:")));
  assert.equal((await db.get("minutes"))?.draftTranscript, merged.text);
  await assert.rejects(
    () => runtime.runMutation("transcripts:mergeSpeakers", { ...base, from: "missing", to: "SPEAKER_01" }),
    /different existing/,
  );
  await assert.rejects(
    () => runtime.runMutation("transcripts:mergeSpeakers", { ...base, from: "SPEAKER_01", to: "SPEAKER_01" }),
    /different existing/,
  );
  await assert.rejects(
    () =>
      runtime.runMutation("transcripts:mergeSpeakers", {
        ...base,
        meetingId: "foreign-meeting",
        from: "A",
        to: "B",
      }),
    /not found|another|denied/i,
  );
  await db.transaction(() => db.patch("minutes", { approvedAt: "2026-01-01", draftTranscript: "frozen" }));
  const approvedMinutes = await db.get("minutes");
  await runtime.runMutation("transcripts:assignSpeaker", { ...base, label: "SPEAKER_01", name: "Jo" });
  await runtime.runMutation("transcripts:updateSegment", {
    ...base,
    index: 0,
    text: "Unapproved working copy",
  });
  await runtime.runMutation("transcripts:importTimed", { ...base, ...vtt });
  await runtime.runMutation("transcripts:mergeSpeakers", { ...base, from: "Jo", to: "Alex Smith" });
  assert.deepEqual(
    await db.get("minutes"),
    approvedMinutes,
    "all four mutations preserve the entire approved minutes row",
  );
  await assert.rejects(
    () =>
      runtime.runMutation("transcripts:assignSpeaker", {
        ...base,
        label: "Alex",
        name: "Foreign",
        personId: "foreign-person",
      }),
    /not found|another|denied/i,
  );
  await assert.rejects(
    () => runtime.runMutation("transcripts:importTimed", { ...base, ...vtt, meetingId: "foreign-meeting" }),
    /not found|another|denied/i,
  );
  await assert.rejects(
    () => runtime.runMutation("transcripts:updateSegment", { ...base, index: -1, text: "x" }),
    /bounds/,
  );
  await assert.rejects(
    () =>
      runtime.runMutation("transcripts:importTimed", {
        ...base,
        provider: "vtt",
        segments: [{ speaker: "A", text: "x", startSec: NaN, endSec: 1 }],
      }),
    /finite/,
  );
  await assert.rejects(
    () => runtime.runMutation("transcripts:importTimed", { ...base, ...vtt, durationSeconds: 1 }),
    /Duration/,
  );
  await assert.rejects(
    () =>
      runtime.runMutation("transcripts:importTimed", {
        ...base,
        ...vtt,
        segments: [...vtt.segments].reverse(),
      }),
    /ordered/,
  );
  const large = {
    ...base,
    provider: "whisper-json",
    segments: Array.from({ length: 700 }, (_, i) => ({
      speaker: "A",
      startSec: i,
      endSec: i + 1,
      text: "word ".repeat(30).trim(),
      words: Array.from({ length: 30 }, (_, j) => ({
        text: "word",
        startSec: i + j / 30,
        endSec: i + (j + 1) / 30,
      })),
    })),
  };
  assert.deepEqual(await runtime.runMutation("transcripts:importTimed", large), { wordsDropped: true });
  assert.equal((await read()).segments[0].words, undefined);
  const beforeOversize = await read();
  await assert.rejects(
    () =>
      runtime.runMutation("transcripts:importTimed", {
        ...base,
        provider: "vtt",
        segments: Array.from({ length: 50 }, (_, i) => ({
          speaker: "A",
          text: "界".repeat(10_000),
          startSec: i,
          endSec: i + 1,
        })),
      }),
    /700 KB/,
  );
  assert.deepEqual(await read(), beforeOversize, "oversized import leaves the existing transcript intact");
  principal = { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "viewer" };
  await assert.rejects(
    () => runtime.runMutation("transcripts:mergeSpeakers", { ...base, from: "A", to: "B" }),
    /meetings:write/,
  );
  await assert.rejects(
    () => runtime.runMutation("transcripts:assignSpeaker", { ...base, label: "A", name: "Denied" }),
    /meetings:write/,
  );
  await assert.rejects(
    () => runtime.runMutation("transcripts:updateSegment", { ...base, index: 0, text: "Denied" }),
    /meetings:write/,
  );
  await assert.rejects(
    () => runtime.runMutation("transcripts:importTimed", { ...base, ...vtt }),
    /meetings:write/,
  );
  // Working transcripts and their transcription jobs are for minutes keepers (decision A1).
  await assert.rejects(() => runtime.runQuery("transcripts:getByMeeting", { meetingId: "meeting" }), /minutes:write/);
  await assert.rejects(() => runtime.runQuery("transcripts:jobForMeeting", { meetingId: "meeting" }), /minutes:write/);
}

// The client skips those queries without transcript access, so a Member or
// Viewer opening the Transcript tab gets no "Permission minutes:write required".
{
  const sources = readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => ({ file, text: readFileSync(path.join("src", file), "utf8") }));
  const reads = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/useQuery\(\s*(?:typedApi|api)\.transcripts\.(getByMeeting|jobForMeeting)\s*,([\s\S]*?)"skip"/g)].map(
      ([, name, args]) => ({ where: `${file} transcripts:${name}`, args }),
    ),
  );
  assert.ok(reads.some((read) => read.where.endsWith("transcripts:jobForMeeting")), "the job query is found");
  for (const read of reads)
    assert.match(read.args, /canReadTranscript|TRANSCRIPT_READ_PERMISSION/, `${read.where} is skipped without transcript access`);
}

// SubViewer (YouTube): `H:MM:SS.mmm,H:MM:SS.mmm` cues, ">>" speaker changes, repeated prefixes.
const sbv = parseTimedTranscript(
  "captions.sbv",
  [
    "0:00:01.000,0:00:03.500",
    ">> Chair: Call to order.",
    "",
    "0:00:03.500,0:00:06.000",
    "Treasurer: The budget",
    "is balanced.",
    "",
    "0:00:06.000,0:00:08.000",
    "Chair: Thank you.",
    "",
    "0:00:08.000,0:00:09.000",
    "Treasurer: Pleasure.",
    "",
  ].join("\r\n"),
);
assert.equal(sbv.provider, "sbv");
assert.deepEqual(
  sbv.segments.map((segment) => [segment.speaker, segment.text, segment.startSec, segment.endSec]),
  [
    ["Chair", "Call to order.", 1, 3.5],
    ["Treasurer", "The budget is balanced.", 3.5, 6],
    ["Chair", "Thank you.", 6, 8],
    ["Treasurer", "Pleasure.", 8, 9],
  ],
  "a prefix counts as a speaker once it repeats, as in VTT and SRT",
);
assert.throws(() => parseTimedTranscript("x.sbv", "no cues here"), /SBV/);
assert.throws(() => parseTimedTranscript("x.sbv", "0:00:05.000,0:00:01.000\nx"), /start before/);
assert.throws(() => parseTimedTranscript("x.sbv", "0:61:00.000,0:62:00.000\nx"), /timestamp/);

// Otter / Teams: "Name  M:SS" header after a blank line, then the turn's text.
const otter = parseTimedTranscript(
  "otter.txt",
  [
    "Board meeting - Nov 12",
    "",
    "Jane Doe  0:05",
    "Welcome everyone. We will reconvene at 7:30",
    "after the break.",
    "",
    "Sam Lee  0:12",
    "Thanks Jane.",
    "",
    "Jane Doe  1:02:03",
    "Meeting adjourned.",
    "",
    "Transcribed by https://otter.ai",
  ].join("\n"),
);
assert.equal(otter.provider, "timestamped-text");
assert.deepEqual(
  otter.segments.map((segment) => [segment.speaker, segment.text, segment.startSec, segment.endSec]),
  [
    ["Jane Doe", "Welcome everyone. We will reconvene at 7:30 after the break.", 5, 12],
    ["Sam Lee", "Thanks Jane.", 12, 3723],
    ["Jane Doe", "Meeting adjourned.", 3723, 3724],
  ],
  "a time inside a turn's text is not a new turn; the title and export footer are dropped",
);

// Rev: "Name (MM:SS):" headers.
const rev = parseTimedTranscript("rev.txt", "Speaker 1 (00:00):\nHello.\n\nSpeaker 2 (00:04):\nHi there.\n");
assert.deepEqual(rev.segments.map((segment) => [segment.speaker, segment.startSec, segment.endSec]), [["Speaker 1", 0, 4], ["Speaker 2", 4, 5]]);

// Descript and similar: "[HH:MM:SS] Name: text" per line.
const descript = parseTimedTranscript(
  "descript.txt",
  "[00:00:01] Alex: Opening remarks.\n[00:00:09] Priya: Seconded.\n[00:00:15] Alex: Carried.\n[00:00:18] Priya: Noted.\n",
);
assert.deepEqual(
  descript.segments.map((segment) => [segment.speaker, segment.text, segment.startSec]),
  [["Alex", "Opening remarks.", 1], ["Priya", "Seconded.", 9], ["Alex", "Carried.", 15], ["Priya", "Noted.", 18]],
);

// Google Meet: a timestamp line every few minutes, then "Name: text" turns sharing its span.
const meet = parseTimedTranscript(
  "meet.txt",
  "Transcript\n\n00:00:00\n\nAlex: Hello all.\nPriya: Hi Alex, thanks for having us.\n\n00:05:00\n\nAlex: Next item.\nPriya: Agreed.\n",
);
assert.deepEqual(meet.segments.map((segment) => segment.speaker), ["Alex", "Priya", "Alex", "Priya"]);
assert.equal(meet.segments[0].startSec, 0);
assert.ok(meet.segments[1].startSec > 0 && meet.segments[1].startSec < 300, "turns split the block's span by length");
assert.equal(meet.segments[1].endSec, 300);
assert.equal(meet.segments[2].startSec, 300);

assert.throws(() => parseTimedTranscript("x.txt", "[00:05] one\n[00:02] two\n"), /backwards/);
assert.throws(() => parseTimedTranscript("x.txt", "Notes from 7:30 meeting\nWe met."), /no timestamps/);

// The in-camera divider names the session once, whatever the minutes call it.
assert.equal(inCameraDividerLabel("Executive director review"), "In camera: Executive director review");
assert.equal(inCameraDividerLabel("In camera: executive director review"), "In camera: executive director review");
assert.equal(inCameraDividerLabel("in camera session"), "in camera session");
assert.equal(inCameraDividerLabel("In-camera session"), "In-camera session");
assert.equal(inCameraDividerLabel("In\u2011camera: staffing"), "In\u2011camera: staffing", "non-breaking hyphen");
assert.equal(inCameraDividerLabel("  IN CAMERA – staffing "), "IN CAMERA – staffing");
assert.equal(inCameraDividerLabel("Incamera budget"), "Incamera budget");
assert.equal(inCameraDividerLabel("Inca budget"), "In camera: Inca budget");
assert.equal(inCameraDividerLabel("Review in camera"), "In camera: Review in camera");
console.log(
  "Timed transcript checks passed: parsers, clock lookup, waveform, registry, both portable adapters, permissions, ownership, draft immutability and size bounds.",
);
