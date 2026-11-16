// "Recordings and transcripts" (MeetingSourcesCard): what each file row says
// and offers, from the upload to its transcription.
//
//   node --import tsx scripts/check-meeting-files.ts
import assert from "node:assert/strict";
import { latestJobBySource, meetingFileRow, type FileCapabilities, type FileJob } from "../src/features/meetings/components/meetingFileRows";
import type { MeetingSource } from "../src/lib/meetingSourceTransfer";

const LIMIT = 1_000_000;
const recording = (extra: Partial<MeetingSource> = {}): MeetingSource => ({ id: "s1", fileName: "Board call.m4a", size: 40_000_000, kind: "recording", status: "ready", offset: 40_000_000, verifiedOffset: 40_000_000, ...extra });
const transcriptFile = (extra: Partial<MeetingSource> = {}): MeetingSource => ({ id: "s2", fileName: "Board call.vtt", size: 80_000, kind: "transcript", status: "ready", offset: 80_000, verifiedOffset: 80_000, textComplete: true, textBytes: 70_000, ...extra });
const job = (status: string, extra: Partial<FileJob> = {}): FileJob => ({ id: "j1", sourceId: "s1", status, phase: null, progress: null, error: null, segmentCount: 0, ...extra });
const editor: FileCapabilities = { whisperX: true, speech: false, canDraft: true, canReadTranscript: true };

// A recording with a WhisperX processor: play and transcribe on the row.
assert.deepEqual(meetingFileRow(recording(), undefined, editor, LIMIT), { status: "Recording", tone: "neutral", actions: ["play", "transcribe", "preview", "download"] });
// Its transcription, step by step, on the same row.
assert.deepEqual(meetingFileRow(recording(), job("queued"), editor, LIMIT).actions, ["play", "cancelTranscription", "preview", "download"]);
assert.equal(meetingFileRow(recording(), job("queued"), editor, LIMIT).status, "Queued for transcription");
const running = meetingFileRow(recording(), job("running", { progress: 0.42, phase: "Aligning words" }), editor, LIMIT);
assert.equal(running.status, "Transcribing · 42% · Aligning words");
assert.equal(running.tone, "busy");
const ready = meetingFileRow(recording(), job("ready", { segmentCount: 1234 }), editor, LIMIT);
assert.equal(ready.status, "Transcript ready · 1,234 segments");
assert.deepEqual(ready.actions, ["play", "reviewTranscription", "useTranscription", "cancelTranscription", "preview", "download"]);
assert.equal(meetingFileRow(recording(), job("applied"), editor, LIMIT).status, "Transcribed · in use as the meeting transcript");
const failed = meetingFileRow(recording(), job("failed", { error: "Worker offline" }), editor, LIMIT);
assert.equal(failed.status, "Transcription failed: Worker offline");
assert.ok(failed.actions.includes("retryTranscription"));
assert.ok(meetingFileRow(recording(), job("cancelled"), editor, LIMIT).actions.includes("transcribe"), "a cancelled job can be queued again");
console.log("✓ recording rows: play and transcribe, then queued, transcribing with progress, ready to review and use, applied, failed with retry");

// Without a processor: the speech provider, or no transcription at all.
assert.ok(meetingFileRow(recording(), undefined, { ...editor, whisperX: false, speech: true }, LIMIT).actions.includes("transcribe"));
assert.ok(!meetingFileRow(recording(), undefined, { ...editor, whisperX: false, speech: false }, LIMIT).actions.includes("transcribe"), "nothing to transcribe with");
assert.equal(meetingFileRow(recording({ jobStatus: "processing" }), undefined, { ...editor, whisperX: false, speech: true }, LIMIT).status, "Transcribing…");
const spoken = meetingFileRow(recording({ textComplete: true, textBytes: 5000 }), undefined, { ...editor, whisperX: false, speech: true }, LIMIT);
assert.deepEqual(spoken.actions, ["play", "readText", "useText", "preview", "download"], "the speech provider's text can be read and used");
// Someone without minutes access: no transcribing, playing or reading.
assert.deepEqual(meetingFileRow(recording(), job("ready", { segmentCount: 3 }), { ...editor, canDraft: false, canReadTranscript: false }, LIMIT).actions, ["cancelTranscription", "preview", "download"]);
console.log("✓ without a processor, and for people who can't read transcripts");

// Transcript files and uploads in progress.
assert.deepEqual(meetingFileRow(transcriptFile(), undefined, editor, LIMIT), { status: "Transcript file · text imported", tone: "neutral", actions: ["readText", "useText", "preview", "download"] });
assert.ok(!meetingFileRow(transcriptFile({ textBytes: 2_000_000 }), undefined, editor, LIMIT).actions.includes("useText"), "too long to use for minutes in one go");
const partial = meetingFileRow(recording({ status: "uploading", offset: 10_000_000, verifiedOffset: 0 }), undefined, editor, LIMIT);
assert.equal(partial.status, "Upload not finished (25%): choose the same file to resume");
assert.deepEqual(partial.actions, ["cancelUpload"]);
assert.deepEqual(meetingFileRow(recording({ status: "cancelled" }), undefined, editor, LIMIT).actions, []);
console.log("✓ transcript files, unfinished and cancelled uploads");

// Jobs arrive newest first: each recording shows its latest.
const latest = latestJobBySource([job("running", { id: "new" }), job("failed", { id: "old" }), job("ready", { id: "other", sourceId: "s9" })]);
assert.equal(latest.get("s1")?.id, "new");
assert.equal(latest.get("s9")?.id, "other");
assert.equal(latestJobBySource(undefined).size, 0);
console.log("✓ the latest job per recording");
