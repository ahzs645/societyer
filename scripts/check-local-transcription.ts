/**
 * On-device transcription ("Transcribe on this device"):
 *
 * 1. Reply parsers for OpenAI verbose_json (top-level words), whisper.cpp
 *    verbose_json and CLI JSON, and WhisperX (speakers, split mid-line), plus
 *    the lenient edge cases.
 * 2. Long recordings: the part plan, and the merge that shifts timestamps and
 *    keeps each overlap once (pure functions).
 * 3. The browser client against the mock server for each server kind:
 *    multipart fields, keys, status errors that never echo provider bodies,
 *    abort, Test connection.
 * 4. The desktop pipeline (electron/localTranscription.ts behind a bridge that
 *    mirrors ipc/aiHandlers.ts): ordered pieces into a private temp file,
 *    ffmpeg parts (a stand-in ffmpeg script), cleanup, cancel.
 * 5. `transcripts:importTimed` with provider "local-whisper" on both portable
 *    adapters keeps words and speakers; the 20,000-segment limit; words are
 *    dropped to fit the row.
 * 6. Draft minutes is disabled, with a reason, while a transcription runs.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  finishTranscription,
  mergeTranscriptionParts,
  parseTranscriptionReply,
  planAudioChunks,
  speechFormFields,
  speechRequestUrl,
  TRANSCRIPT_SEGMENT_LIMIT,
} from "../shared/ai/transcription";
import type { TranscriptSegment } from "../shared/transcriptModel";
import { MOCK_SPEECH_LINES, mockSpeechReply, PROVIDER_SECRET_MARKER, startMockOpenAiServer, type RecordedSpeechForm } from "./fixtures/mock-openai-server";
import {
  desktopSpeechTransport,
  directSpeechTransport,
  silentWav,
  testSpeechToText,
  transcribeRecording,
  type SpeechProgress,
} from "../src/lib/localAi/transcription";
import { BROWSER_UNREACHABLE_HINT, DeviceAiError } from "../src/lib/localAi/transport";
import { parseDeviceAiConfig, speechToTextReadiness } from "../src/lib/localAi/config";
import { parseFfmpegDuration, TranscriptionUploads, transcribeUpload, wavArgs } from "../electron/localTranscription";
import { LocalAiProxyError, sanitizeLocalAiConfig, speechProxyTargetUrl } from "../electron/localAiProxy";
import type { DesktopLocalAiConfig, SocietyerDesktopBridge } from "../src/lib/desktopBridge";
import { LocalStoreDb, MemoryDb, MemoryRowStore, PortableRuntime, makeCapabilities } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { actionPermission } from "../shared/functions/actionPolicy";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import { draftMinutesDisabledReason } from "../src/features/meetings/transcript/useLocalTranscription";

// --- 1. Parsers -----------------------------------------------------------------

{
  const openai = parseTranscriptionReply(JSON.stringify(mockSpeechReply("openai")));
  assert.equal(openai.segments.length, 3);
  assert.deepEqual(openai.segments.map((segment) => segment.speaker), ["Speaker", "Speaker", "Speaker"], "no diarization: one placeholder label");
  assert.equal(openai.speakerCount, 0);
  assert.equal(openai.segments[0].text, "I call the meeting to order.");
  assert.deepEqual(openai.segments[1].words?.map((word) => word.text), ["I", "move", "that", "we", "approve", "the", "budget."], "top-level words go to their segment");
  assert.equal(openai.durationSec, 10.5);
  assert.equal(openai.language, "english");

  const cpp = parseTranscriptionReply(mockSpeechReply("whisper-cpp"));
  assert.equal(cpp.segments.length, 3);
  assert.equal(cpp.segments[0].words?.[0].text, "I", "leading spaces in whisper.cpp words are trimmed");
  assert.equal(cpp.segments[2].words?.length, 3);

  const whisperx = parseTranscriptionReply(mockSpeechReply("whisperx"));
  assert.deepEqual(
    whisperx.segments.map((segment) => [segment.speaker, segment.text, segment.startSec, segment.endSec]),
    [
      ["SPEAKER_00", "I call the meeting to order.", 0, 3.2],
      ["SPEAKER_01", "I move that we approve the budget.", 3.4, 7.9],
      ["SPEAKER_02", "Seconded.", 8, 9.2],
      ["SPEAKER_00", "Thank you.", 9.2, 10.5],
    ],
    "a line whose words change speaker is split at the change",
  );
  assert.equal(whisperx.speakerCount, 3);
  assert.deepEqual(whisperx.segments[3].words?.map((word) => word.text), ["Thank", "you."]);

  // whisper.cpp CLI JSON (-oj): offsets in milliseconds, numeric speakers.
  const cli = parseTranscriptionReply({
    transcription: [
      { offsets: { from: 0, to: 2500 }, text: " Good evening.", speaker: 0 },
      { offsets: { from: 2600, to: 4000 }, text: " Welcome.", speaker: 1 },
    ],
  });
  assert.deepEqual(cli.segments.map((segment) => [segment.speaker, segment.startSec, segment.endSec]), [["SPEAKER_00", 0, 2.5], ["SPEAKER_01", 2.6, 4]]);

  // Only words: lines break at sentence ends and pauses.
  const wordsOnly = parseTranscriptionReply({ words: [{ word: "Hello", start: 0, end: 0.4 }, { word: "all.", start: 0.5, end: 0.9 }, { word: "Next", start: 3, end: 3.3 }, { word: "item", start: 3.4, end: 3.8 }] });
  assert.deepEqual(wordsOnly.segments.map((segment) => segment.text), ["Hello all.", "Next item"]);

  // Lenient with what servers really send: bad rows are skipped, not fatal.
  const messy = parseTranscriptionReply({
    duration: 5,
    segments: [
      { start: 2, end: 3, text: "second", words: [{ word: "second", start: 2.1, end: 9 }] },
      { start: 0, end: 1, text: "first" },
      { start: null, end: 1, text: "no start" },
      { start: 4, end: 3.9, text: "end before start" },
      { start: 1, end: 2, text: "   " },
    ],
  });
  assert.deepEqual(messy.segments.map((segment) => segment.text), ["first", "second", "end before start"], "sorted; untimed and empty lines dropped");
  assert.equal(messy.segments[1].words?.[0].endSec, 3, "words are clamped into their line");
  assert.equal(messy.segments[2].endSec, 4);
  assert.equal(parseTranscriptionReply({ text: "Only text", duration: 7 }).segments[0].endSec, 7, "text with a duration becomes one line");
  assert.equal(parseTranscriptionReply(mockSpeechReply("openai", true)).segments.length, 0, "silence: no segments, no error");
  assert.throws(() => parseTranscriptionReply("not json"), /not JSON/);
  assert.throws(() => parseTranscriptionReply("[1]"), /not readable/);
  const tooMany = { segments: Array.from({ length: TRANSCRIPT_SEGMENT_LIMIT + 1 }, (_, index) => ({ start: index, end: index + 1, text: "a" })) };
  assert.throws(() => parseTranscriptionReply(tooMany), /20,000/);

  // Request shapes per server kind.
  assert.equal(speechRequestUrl("openai-compatible", "http://127.0.0.1:8000/v1/"), "http://127.0.0.1:8000/v1/audio/transcriptions");
  assert.equal(speechRequestUrl("whisper-cpp", "http://127.0.0.1:8081"), "http://127.0.0.1:8081/inference");
  assert.deepEqual(speechFormFields("openai-compatible", { model: "Systran/faster-whisper-small" }), [
    ["model", "Systran/faster-whisper-small"],
    ["response_format", "verbose_json"],
    ["timestamp_granularities[]", "word"],
    ["timestamp_granularities[]", "segment"],
  ]);
  assert.deepEqual(speechFormFields("whisper-cpp", { model: "ignored" }), [["response_format", "verbose_json"], ["temperature", "0.0"], ["temperature_inc", "0.2"]]);
  assert.ok(speechFormFields("whisperx").some(([name, value]) => name === "diarize" && value === "true"));
}

// --- 2. Parts -------------------------------------------------------------------

{
  assert.deepEqual(planAudioChunks(0), []);
  assert.deepEqual(planAudioChunks(620), [{ startSec: 0, lengthSec: 620 }], "a recording just over 10 minutes stays whole");
  assert.deepEqual(planAudioChunks(1500), [
    { startSec: 0, lengthSec: 605 },
    { startSec: 600, lengthSec: 605 },
    { startSec: 1200, lengthSec: 300 },
  ]);
  assert.deepEqual(planAudioChunks(1230).at(-1), { startSec: 600, lengthSec: 630 }, "a short tail joins the part before it");

  const line = (startSec: number, endSec: number, text: string, speaker = "Speaker"): TranscriptSegment => ({
    speaker,
    text,
    startSec,
    endSec,
    words: [{ text: text.split(" ")[0], startSec, endSec: Math.min(endSec, startSec + 0.4) }],
  });
  const merged = mergeTranscriptionParts(
    [
      { offsetSec: 600, segments: [line(0.5, 1.5, "in both parts"), line(1.8, 4, "said across the boundary"), line(4, 6, "after the boundary")] },
      { offsetSec: 0, segments: [line(10, 20, "early"), line(599, 601, "before the boundary"), line(601.6, 603.5, "in both parts and said across the boundary")] },
    ],
    5,
  );
  assert.deepEqual(
    merged.map((segment) => [segment.startSec, segment.text]),
    [
      [10, "early"],
      [599, "before the boundary"],
      [601.6, "in both parts and said across the boundary"],
      [604, "after the boundary"],
    ],
    "each side keeps its half of the overlap and a repeated straddling line is dropped",
  );
  assert.deepEqual(merged[3].words?.[0], { text: "after", startSec: 604, endSec: 604.4 }, "word timings move with their part");
  assert.throws(() => finishTranscription([], 0), /No speech/);
  assert.throws(() => finishTranscription(Array.from({ length: TRANSCRIPT_SEGMENT_LIMIT + 1 }, (_, index) => line(index, index + 1, "a")), 0), /20,000/);
  assert.equal(finishTranscription([line(0, 2, "x")], 9).durationSeconds, 9);
}

// --- 3. Browser client ------------------------------------------------------------

const server = await startMockOpenAiServer();
const fixturePath = "/tmp/societyer-transcript/fixture/board-meeting.wav";
const recording = existsSync(fixturePath)
  ? new File([readFileSync(fixturePath)], "board-meeting.wav", { type: "audio/wav" })
  : new File([new Uint8Array(400_000)], "board-meeting.wav", { type: "audio/wav" });
const speechForms = () => server.requests.filter((request) => request.path === "/v1/audio/transcriptions" || request.path === "/inference").map((request) => request.body as RecordedSpeechForm);

async function rejectsWith(promise: Promise<unknown>, code: DeviceAiError["code"], label: string) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DeviceAiError, `${label}: a DeviceAiError, got ${String(error)}`);
    assert.equal(error.code, code, `${label}: ${error.message}`);
    assert.doesNotMatch(error.message, new RegExp(PROVIDER_SECRET_MARKER), `${label}: provider bodies are never echoed`);
    return error;
  }
  assert.fail(`${label}: expected a rejection`);
}

try {
  const direct = (kind: "openai-compatible" | "whisper-cpp" | "whisperx", apiKey = "", baseUrl = kind === "whisper-cpp" ? server.origin : server.baseUrl) =>
    directSpeechTransport(() => ({ kind, baseUrl, model: kind === "whisper-cpp" ? "" : "mock-whisper", apiKey }));

  const progress: SpeechProgress[] = [];
  const openai = await transcribeRecording({ transport: direct("openai-compatible"), file: recording, fileName: recording.name, onProgress: (step) => progress.push(step) });
  assert.equal(openai.provider, "local-whisper");
  assert.equal(openai.segments.length, 3);
  assert.equal(openai.speakerCount, 0);
  assert.equal(openai.durationSeconds, 10.5);
  assert.deepEqual(progress, [{ phase: "transcribing", part: 1, parts: 1 }]);
  const sent = speechForms().at(-1)!;
  assert.equal(sent.fileName, "board-meeting.wav");
  assert.equal(sent.fileBytes, recording.size, "the whole file is sent");
  assert.deepEqual(sent.fields["timestamp_granularities[]"], ["word", "segment"]);
  assert.deepEqual(sent.fields.response_format, ["verbose_json"]);
  assert.deepEqual(sent.fields.model, ["mock-whisper"]);
  assert.equal(server.requests.at(-1)?.authorization, undefined, "no key: no Authorization header");

  const cpp = await transcribeRecording({ transport: direct("whisper-cpp"), file: recording, fileName: recording.name });
  assert.equal(server.requests.at(-1)?.path, "/inference");
  assert.equal(cpp.segments[0].words?.length, 6);
  assert.deepEqual(speechForms().at(-1)!.fields.temperature, ["0.0"]);

  const whisperx = await transcribeRecording({ transport: direct("whisperx", "speech-key"), file: recording, fileName: recording.name });
  assert.equal(whisperx.speakerCount, 3);
  assert.equal(whisperx.segments.length, 4);
  assert.equal(server.requests.at(-1)?.authorization, "Bearer speech-key");
  assert.deepEqual(speechForms().at(-1)!.fields.diarize, ["true"]);

  // Failures: plain messages, never the provider's body.
  server.set({ speechStatus: 500 });
  const failed = await rejectsWith(transcribeRecording({ transport: direct("openai-compatible"), file: recording, fileName: recording.name }), "status", "server error");
  assert.equal(failed.status, 500);
  server.set({ speechStatus: 415 });
  await rejectsWith(transcribeRecording({ transport: direct("whisper-cpp"), file: recording, fileName: recording.name }), "status", "format refused");
  server.reset();
  server.set({ requireKey: "right" });
  await rejectsWith(transcribeRecording({ transport: direct("openai-compatible", "wrong"), file: recording, fileName: recording.name }), "status", "wrong key");
  server.reset();
  const unreachable = await rejectsWith(
    transcribeRecording({ transport: direct("openai-compatible", "", "http://127.0.0.1:9/v1"), file: recording, fileName: recording.name }),
    "network",
    "unreachable",
  );
  assert.equal(unreachable.message, "Nothing answered at 127.0.0.1:9.", "a closed port is nothing listening, not CORS");
  assert.equal(unreachable.hint, BROWSER_UNREACHABLE_HINT);
  // A server that answers a no-cors probe is up but blocks this page.
  const corsBlocked = directSpeechTransport(
    () => ({ kind: "openai-compatible", baseUrl: "http://127.0.0.1:8000/v1", model: "mock-whisper", apiKey: "" }),
    (_input, init) => (init?.mode === "no-cors" ? Promise.resolve(new Response(null)) : Promise.reject(new TypeError("Failed to fetch"))),
  );
  const blocked = await rejectsWith(transcribeRecording({ transport: corsBlocked, file: recording, fileName: recording.name }), "network", "CORS-blocked");
  assert.equal(blocked.message, "127.0.0.1:8000 is running but doesn't allow requests from this page.");
  assert.match(blocked.hint ?? "", /CORS.*speaches/);
  await rejectsWith(transcribeRecording({ transport: direct("openai-compatible"), file: new File([], "empty.wav"), fileName: "empty.wav" }), "refused", "empty file");

  // Cancel while the server is working.
  server.set({ stallMs: 3000 });
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 150);
  await rejectsWith(transcribeRecording({ transport: direct("openai-compatible"), file: recording, fileName: recording.name, signal: controller.signal }), "aborted", "cancel");
  assert.ok(Date.now() - started < 2000, "cancel stops the request at once");
  await rejectsWith(transcribeRecording({ transport: direct("openai-compatible"), file: recording, fileName: recording.name, timeoutMs: 100 }), "timeout", "runaway bound");
  server.reset();

  // Test connection: a second of silence through the same path.
  assert.equal(silentWav().byteLength, 44 + 32_000);
  const tested = await testSpeechToText(direct("openai-compatible"));
  assert.ok(tested.ok, "silence is a readable, empty reply");
  assert.ok(speechForms().at(-1)!.fileBytes < 64 * 1024);
  const testFailed = await testSpeechToText(direct("openai-compatible", "", "http://127.0.0.1:9/v1"));
  assert.ok(!testFailed.ok && /Nothing answered at/.test(testFailed.message));

  // Settings: speech-to-text is its own section, with its own key.
  const config = parseDeviceAiConfig({ speechToText: { kind: "whisperx", baseUrl: "http://127.0.0.1:8000/v1/", model: "large-v3" } });
  assert.deepEqual(config.speechToText, { kind: "whisperx", baseUrl: "http://127.0.0.1:8000/v1", model: "large-v3" });
  assert.equal(parseDeviceAiConfig({ speechToText: { kind: "bogus" } }).speechToText.kind, "none");
  assert.deepEqual(speechToTextReadiness({ config, keyStored: false, speechKeyStored: false, loaded: true }), { ready: true }, "a local server needs no key, and chat can stay off");
  const hosted = parseDeviceAiConfig({ speechToText: { kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "whisper-1" } });
  assert.equal(speechToTextReadiness({ config: hosted, keyStored: true, speechKeyStored: false, loaded: true }).ready, false, "the chat key is not the speech key");
  assert.equal(speechToTextReadiness({ config: parseDeviceAiConfig({ speechToText: { kind: "whisper-cpp", baseUrl: "http://speech.example.com" } }), keyStored: false, speechKeyStored: false, loaded: true }).ready, false, "public http is refused");

  // --- 4. Desktop pipeline ------------------------------------------------------------

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "societyer-stt-check-"));
  const leftovers = () => readdirSync(tempRoot);
  const desktopSpeech = (kind: "openai-compatible" | "whisper-cpp" | "whisperx"): DesktopLocalAiConfig["speechToText"] => ({
    kind,
    baseUrl: kind === "whisper-cpp" ? server.origin : server.baseUrl,
    model: "mock-whisper",
  });
  /** The same steps as ipc/aiHandlers.ts, minus Electron. */
  function fakeBridge(speech: DesktopLocalAiConfig["speechToText"], ffmpeg: string | null) {
    const uploads = new TranscriptionUploads(tempRoot);
    const inFlight = new Map<string, AbortController>();
    const pieces: number[] = [];
    const bridge: Pick<SocietyerDesktopBridge, "localAiTranscriptionUpload" | "localAiTranscribe" | "localAiAbort"> = {
      async localAiTranscriptionUpload(input) {
        pieces.push(input.bytes.byteLength);
        return { received: await uploads.write(input.requestId, { ...input, bytes: new Uint8Array(input.bytes) }) };
      },
      async localAiTranscribe(input, onEvent) {
        const upload = uploads.take(input.requestId);
        if (!upload) return { ok: false, code: "refused", message: "Send the whole recording first." };
        const controller = new AbortController();
        inFlight.set(input.requestId, controller);
        try {
          return await transcribeUpload({ fetchImpl: fetch, speech, apiKey: "main-process-key", signal: controller.signal, upload, emit: onEvent, ffmpeg });
        } finally {
          inFlight.delete(input.requestId);
          rmSync(upload.dir, { recursive: true, force: true });
        }
      },
      async localAiAbort(requestId) {
        inFlight.get(requestId)?.abort();
        await uploads.discard(requestId);
      },
    };
    return { bridge, pieces, uploads };
  }

  // Without ffmpeg: the original file, in ordered pieces, then one request.
  {
    const { bridge, pieces, uploads } = fakeBridge(desktopSpeech("openai-compatible"), null);
    const steps: SpeechProgress[] = [];
    const result = await transcribeRecording({ transport: desktopSpeechTransport(bridge, 256 * 1024), file: recording, fileName: recording.name, onProgress: (step) => steps.push(step) });
    assert.equal(result.segments.length, 3);
    assert.ok(pieces.length > 1 && pieces.every((bytes) => bytes <= 256 * 1024), "copied in pieces, never one large message");
    assert.equal(speechForms().at(-1)!.fileBytes, recording.size, "the server receives the whole recording");
    assert.equal(server.requests.at(-1)?.authorization, "Bearer main-process-key", "the key is added in the main process");
    assert.deepEqual(steps.at(-1), { phase: "transcribing", part: 1, parts: 1 });
    assert.ok(steps.some((step) => step.phase === "uploading" && step.sentBytes === recording.size));
    assert.deepEqual(leftovers(), [], "the temporary recording is deleted");
    assert.equal(uploads.size, 0);
  }

  // Pieces out of order are refused, and an abandoned upload can be discarded.
  {
    const uploads = new TranscriptionUploads(tempRoot);
    await uploads.write("x", { fileName: "a.wav", totalBytes: 10, offset: 0, bytes: new Uint8Array(4) });
    await assert.rejects(uploads.write("x", { fileName: "a.wav", totalBytes: 10, offset: 8, bytes: new Uint8Array(2) }), /out of order/);
    await assert.rejects(uploads.write("x", { fileName: "a.wav", totalBytes: 10, offset: 4, bytes: new Uint8Array(7) }), /larger than announced/);
    assert.equal(uploads.take("x"), null, "an incomplete upload is never transcribed");
    await assert.rejects(uploads.write("y", { fileName: "b.wav", totalBytes: 3 * 1024 ** 3, offset: 0, bytes: new Uint8Array(1) }), /2 GB/);
    await uploads.discard("x");
    assert.deepEqual(leftovers(), []);
  }

  // A stand-in ffmpeg: reports a 25-minute duration and copies the input for each part.
  const fakeFfmpeg = path.join(tempRoot, "..", `fake-ffmpeg-${process.pid}.mjs`);
  writeFileSync(
    fakeFfmpeg,
    [
      "#!/usr/bin/env node",
      "import { copyFileSync, appendFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (process.env.FAKE_FFMPEG_LOG) appendFileSync(process.env.FAKE_FFMPEG_LOG, JSON.stringify(args) + '\\n');",
      "if (args.includes('-version')) { console.log('ffmpeg version fake'); process.exit(0); }",
      "const input = args[args.indexOf('-i') + 1];",
      "if (!args.includes('-f')) { console.error(`Input #0, wav, from '${input}':\\n  Duration: 00:25:00.00, bitrate: 256 kb/s`); process.exit(1); }",
      "copyFileSync(input, args.at(-1));",
    ].join("\n"),
  );
  chmodSync(fakeFfmpeg, 0o755);
  const ffmpegLog = path.join(os.tmpdir(), `fake-ffmpeg-${process.pid}.log`);
  process.env.FAKE_FFMPEG_LOG = ffmpegLog;
  try {
    {
      const { bridge } = fakeBridge(desktopSpeech("openai-compatible"), fakeFfmpeg);
      const steps: SpeechProgress[] = [];
      const result = await transcribeRecording({ transport: desktopSpeechTransport(bridge), file: recording, fileName: recording.name, onProgress: (step) => steps.push(step) });
      assert.ok(steps.some((step) => step.phase === "converting"));
      assert.deepEqual(
        steps.filter((step) => step.phase === "transcribing"),
        [1, 2, 3].map((part) => ({ phase: "transcribing", part, parts: 3 })),
        "25 minutes: three ~10-minute parts",
      );
      // Each part answers the same three lines; parts 2 and 3 lose the line in their half of the overlap.
      assert.deepEqual(
        result.segments.map((segment) => segment.startSec),
        [0, 3.4, 8, 603.4, 608, 1203.4, 1208],
        "timestamps are shifted to each part's place in the recording",
      );
      assert.equal(result.parts, 3);
      const calls = readFileSync(ffmpegLog, "utf8").trim().split("\n").map((row) => JSON.parse(row) as string[]).filter((args) => args.includes("-f"));
      assert.deepEqual(calls.map((args) => args[args.indexOf("-ss") + 1]), ["0.000", "600.000", "1200.000"]);
      assert.ok(calls.every((args) => args.includes("16000") && args.includes("pcm_s16le")), "16 kHz mono WAV parts");
      assert.match(speechForms().at(-1)!.fileName ?? "", /^part-2\.wav$/);
      assert.deepEqual(leftovers(), [], "parts and the recording are deleted");
    }
    {
      // A server that labels speakers gets the recording in one converted part.
      writeFileSync(ffmpegLog, "");
      const { bridge } = fakeBridge(desktopSpeech("whisperx"), fakeFfmpeg);
      const result = await transcribeRecording({ transport: desktopSpeechTransport(bridge), file: recording, fileName: recording.name });
      assert.equal(result.parts, 1);
      assert.equal(result.speakerCount, 3);
      const calls = readFileSync(ffmpegLog, "utf8").trim().split("\n").map((row) => JSON.parse(row) as string[]).filter((args) => args.includes("-f"));
      assert.equal(calls.length, 1);
      assert.ok(!calls[0].includes("-ss"), "whole recording, no parts");
    }
    {
      // Cancel during a part: nothing is returned and the temp folder goes.
      server.set({ stallMs: 3000 });
      const { bridge } = fakeBridge(desktopSpeech("openai-compatible"), fakeFfmpeg);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 300);
      await rejectsWith(transcribeRecording({ transport: desktopSpeechTransport(bridge), file: recording, fileName: recording.name, signal: controller.signal }), "aborted", "desktop cancel");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(leftovers(), []);
      server.reset();
    }
  } finally {
    rmSync(fakeFfmpeg, { force: true });
    rmSync(ffmpegLog, { force: true });
  }
  assert.equal(parseFfmpegDuration("  Duration: 01:02:03.50, start: 0"), 3723.5);
  assert.equal(parseFfmpegDuration("no banner"), 0);
  assert.deepEqual(wavArgs("in.m4a", "out.wav", null), ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", "in.m4a", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "out.wav"]);

  // The desktop proxy only reaches the speech path for the configured kind.
  assert.equal(speechProxyTargetUrl(desktopSpeech("whisper-cpp"), "/inference"), `${server.origin}/inference`);
  assert.throws(() => speechProxyTargetUrl(desktopSpeech("whisper-cpp"), "/audio/transcriptions"), LocalAiProxyError);
  assert.throws(() => speechProxyTargetUrl({ kind: "none", baseUrl: server.baseUrl, model: "" }), /off/);
  assert.throws(() => speechProxyTargetUrl({ kind: "openai-compatible", baseUrl: "http://speech.example.com/v1", model: "" }), /https/);
  assert.equal(sanitizeLocalAiConfig({ speechToText: { kind: "whisperx", baseUrl: "http://127.0.0.1:8000/v1/" } }).speechToText.baseUrl, "http://127.0.0.1:8000/v1");
  rmSync(tempRoot, { recursive: true, force: true });
} finally {
  await server.close();
}

// --- 5. importTimed round trip ------------------------------------------------------

{
  const transcript = parseTranscriptionReply(mockSpeechReply("whisperx"));
  const finished = finishTranscription(transcript.segments, transcript.durationSec);
  assert.equal(actionPermission("transcripts:importTimed", "mutation"), "meetings:write");
  for (const local of [false, true]) {
    const societyId = "stt-test";
    const seed = {
      ...portableTestSeed(societyId),
      meetings: [{ _id: "meeting", societyId }],
      minutes: [{ _id: "minutes", societyId, meetingId: "meeting", draftTranscript: "before" }],
    };
    const db = local ? new LocalStoreDb(new MemoryRowStore(seed)) : new MemoryDb({ seed });
    const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => portableTestPrincipal() }).registerAll(PORTABLE_FUNCTIONS);
    const base = { societyId, meetingId: "meeting" };
    assert.deepEqual(await runtime.runMutation("transcripts:importTimed", { ...base, provider: "local-whisper", ...finished }), { wordsDropped: false });
    const row = await runtime.runQuery<{ provider: string; text: string; segments: TranscriptSegment[]; durationSeconds: number }>("transcripts:getByMeeting", { meetingId: "meeting" });
    assert.equal(row.provider, "local-whisper");
    assert.deepEqual(row.segments.map((segment) => segment.speaker), ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02", "SPEAKER_00"], "speakers survive the round trip");
    assert.deepEqual(row.segments[1].words?.map((word) => word.text), MOCK_SPEECH_LINES[1].words.map(([text]) => text), "words survive the round trip");
    assert.equal(row.durationSeconds, 10.5);
    assert.match(row.text, /^SPEAKER_00: I call the meeting to order\./);
    assert.match(String((await db.get("minutes"))?.draftTranscript), /SPEAKER_01: I move/, "the unapproved draft sees the new transcript");

    // A long meeting with word timings: words are dropped to fit the row, segments kept.
    const long = Array.from({ length: 900 }, (_, index): TranscriptSegment => ({
      speaker: `SPEAKER_0${index % 3}`,
      text: "word ".repeat(25).trim(),
      startSec: index * 4,
      endSec: index * 4 + 3,
      words: Array.from({ length: 25 }, (_, at) => ({ text: "word", startSec: index * 4 + at * 0.1, endSec: index * 4 + at * 0.1 + 0.08 })),
    }));
    assert.deepEqual(await runtime.runMutation("transcripts:importTimed", { ...base, provider: "local-whisper", segments: long, durationSeconds: 3600 }), { wordsDropped: true });
    const trimmed = await runtime.runQuery<{ segments: TranscriptSegment[] }>("transcripts:getByMeeting", { meetingId: "meeting" });
    assert.equal(trimmed.segments.length, 900);
    assert.equal(trimmed.segments[0].words, undefined);

    const overLimit = Array.from({ length: TRANSCRIPT_SEGMENT_LIMIT + 1 }, (_, index) => ({ speaker: "Speaker", text: "a", startSec: index, endSec: index + 1 }));
    await assert.rejects(runtime.runMutation("transcripts:importTimed", { ...base, provider: "local-whisper", segments: overLimit }), /20,000/);
    await assert.rejects(runtime.runMutation("transcripts:importTimed", { ...base, provider: "cloud-whisper", ...finished }), /Unsupported/);
  }
}

// --- 6. Draft minutes waits for a transcription in progress ---------------------

{
  const noAi = "AI minutes drafting needs a connected server or an on-device model.";
  assert.equal(draftMinutesDisabledReason({ aiAvailable: true, transcribing: false }), undefined);
  assert.equal(draftMinutesDisabledReason({ aiAvailable: true, transcribing: true }), "Wait for the transcription to finish.");
  assert.equal(draftMinutesDisabledReason({ aiAvailable: false, transcribing: false }), noAi);
  assert.equal(draftMinutesDisabledReason({ aiAvailable: false, transcribing: true }), noAi, "the lasting reason wins");
}

console.log("Local transcription checks passed: parsers (OpenAI, whisper.cpp, WhisperX), parts and overlap merge, browser client against the mock (fields, keys, errors, cancel, test), the desktop pipeline (pieces, ffmpeg parts, cleanup, cancel), and importTimed round trips with the 20,000-segment limit; Draft minutes waits for a transcription in progress.");
