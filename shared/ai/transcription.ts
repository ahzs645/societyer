/**
 * SPEECH-TO-TEXT REPLIES → TIMED TRANSCRIPT SEGMENTS (pure, no I/O).
 *
 * Shared by the Transcript tab's Whisper JSON import, on-device transcription
 * in the browser and the desktop app, and the checks. Understands:
 *
 * - OpenAI `verbose_json` (faster-whisper / speaches / LM Studio): segments,
 *   with word timings at the top level (`timestamp_granularities[]=word`).
 * - whisper.cpp server `/inference` `verbose_json`: segments with their own
 *   `words[]`; and the whisper.cpp CLI JSON (`transcription[]`, offsets in ms).
 * - WhisperX: `segments[].speaker` and `words[].speaker`. A segment whose
 *   words change speaker is split at each change.
 *
 * Long recordings may be transcribed in overlapping parts; `mergeTranscriptionParts`
 * shifts each part to its place in the recording and drops the overlap once.
 */
import {
  normalizeTranscriptText,
  validateTranscriptSegments,
  type TranscriptSegment,
  type TranscriptWord,
} from "../transcriptModel";
import { SPEECH_CHUNK_OVERLAP_SECONDS } from "./speechRequest";

export * from "./speechRequest";

/** A transcript row holds at most this many segments (`transcripts:importTimed`). */
export const TRANSCRIPT_SEGMENT_LIMIT = 20_000;

// --- The Whisper JSON core (also the Transcript tab's file import) ------------

type Row = Record<string, unknown>;

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON segment or word object.");
  return value as Row;
}

function time(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Transcript times must be finite, non-negative numbers.");
  return value;
}

/**
 * Whisper / WhisperX JSON (`{ segments: [...] }`) to segments, strictly: bad
 * times throw. Words without timings are dropped (common for unaligned WhisperX
 * words); words are clamped into their segment. Order is left to the caller.
 */
export function whisperJsonSegments(root: unknown): TranscriptSegment[] {
  const rows = record(root).segments;
  if (!Array.isArray(rows)) throw new Error("Whisper JSON must contain segments[].");
  if (rows.length > TRANSCRIPT_SEGMENT_LIMIT) throw new Error("Use at most 20,000 transcript segments.");
  return rows.flatMap((value: unknown) => {
    const segment = record(value);
    const startSec = time(segment.start);
    const endSec = time(segment.end);
    if (endSec < startSec) throw new Error("Segment times must start before they end.");
    if (typeof segment.text !== "string") throw new Error("Each JSON segment needs text.");
    const rawWords = Array.isArray(segment.words) ? segment.words.map(record) : [];
    const firstSpeaker = rawWords.find((word) => typeof word.speaker === "string")?.speaker;
    const speaker =
      typeof segment.speaker === "string" ? segment.speaker : typeof firstSpeaker === "string" ? firstSpeaker : "Speaker";
    const clamp = (seconds: number) => Math.max(startSec, Math.min(endSec, seconds));
    const words: TranscriptWord[] = rawWords.flatMap((word) => {
      const start = word.start === undefined ? undefined : time(word.start);
      const end = word.end === undefined ? undefined : time(word.end);
      if (start !== undefined && end !== undefined && end < start) throw new Error("Word times must start before they end.");
      const text = word.word ?? word.text;
      if (typeof text !== "string" || !text.trim() || start === undefined || end === undefined) return [];
      return [{ text: normalizeTranscriptText(text), startSec: clamp(start), endSec: clamp(end) }];
    });
    words.sort((a, b) => a.startSec - b.startSec);
    const body = normalizeTranscriptText(segment.text);
    if (!body) return [];
    return [{ speaker: normalizeTranscriptText(speaker), text: body, startSec, endSec, ...(words.length ? { words } : {}) }];
  });
}

// --- Server replies (lenient pre-pass, then the strict core) ------------------

export type ParsedTranscription = {
  segments: TranscriptSegment[];
  /** The reply's duration, or the last segment's end. */
  durationSec: number;
  language?: string;
  /** Distinct speaker labels the server supplied (0 when it does not diarize). */
  speakerCount: number;
};

type RawWord = { word: string; start: number; end: number; speaker?: string };
type RawSegment = { start: number; end: number; text: string; speaker?: string; words?: RawWord[] };

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function speakerLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return `SPEAKER_${String(value).padStart(2, "0")}`;
  return undefined;
}

function rawWords(value: unknown): RawWord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const word = entry as Row;
    const text = typeof word.word === "string" ? word.word : typeof word.text === "string" ? word.text : "";
    if (!text.trim() || !isTime(word.start) || !isTime(word.end)) return [];
    const speaker = speakerLabel(word.speaker);
    return [{ word: text, start: word.start, end: Math.max(word.start, word.end), ...(speaker ? { speaker } : {}) }];
  });
}

/** Joins word pieces: Whisper words often carry their own leading space, OpenAI words never do. */
function joinWords(words: readonly RawWord[]): string {
  return normalizeTranscriptText(words.reduce((text, word) => (/^\s/.test(word.word) || !text ? text + word.word : `${text} ${word.word}`), ""));
}

function rawSegments(value: unknown): RawSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Row;
    if (!isTime(row.start) || !isTime(row.end) || typeof row.text !== "string") return [];
    const speaker = speakerLabel(row.speaker);
    const words = rawWords(row.words);
    return [{ start: row.start, end: Math.max(row.start, row.end), text: row.text, ...(speaker ? { speaker } : {}), ...(words.length ? { words } : {}) }];
  });
}

/** whisper.cpp CLI JSON: `transcription[]` with `offsets.from/to` in milliseconds. */
function whisperCppCliSegments(value: unknown): RawSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Row;
    const offsets = row.offsets && typeof row.offsets === "object" ? (row.offsets as Row) : {};
    if (!isTime(offsets.from) || !isTime(offsets.to) || typeof row.text !== "string") return [];
    const speaker = speakerLabel(row.speaker);
    return [{ start: offsets.from / 1000, end: Math.max(offsets.from, offsets.to) / 1000, text: row.text, ...(speaker ? { speaker } : {}) }];
  });
}

/** Top-level words (OpenAI) go to the segment they start in. */
function attachWords(segments: RawSegment[], words: readonly RawWord[]): RawSegment[] {
  if (!words.length || segments.some((segment) => segment.words?.length)) return segments;
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const buckets: RawWord[][] = segments.map(() => []);
  let index = 0;
  for (const word of sorted) {
    while (index + 1 < segments.length && segments[index + 1].start <= word.start) index++;
    if (segments.length) buckets[index].push(word);
  }
  return segments.map((segment, at) => (buckets[at].length ? { ...segment, words: buckets[at] } : segment));
}

/** Only words came back: sentence ends, pauses over 1.5 s, speaker changes and 40 words start a new line. */
function segmentsFromWords(words: readonly RawWord[]): RawSegment[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const segments: RawSegment[] = [];
  let run: RawWord[] = [];
  const flush = () => {
    if (!run.length) return;
    const speaker = run.find((word) => word.speaker)?.speaker;
    segments.push({ start: run[0].start, end: Math.max(...run.map((word) => word.end)), text: joinWords(run), words: run, ...(speaker ? { speaker } : {}) });
    run = [];
  };
  for (const word of sorted) {
    const last = run.at(-1);
    if (last && (word.start - last.end > 1.5 || run.length >= 40 || /[.?!]["')\]]?$/.test(last.word.trim()) || (word.speaker && last.speaker && word.speaker !== last.speaker))) flush();
    run.push(word);
  }
  flush();
  return segments;
}

/** WhisperX: a segment whose words change speaker becomes one segment per speaker run. */
function splitBySpeaker(segment: RawSegment): RawSegment[] {
  const words = segment.words ?? [];
  if (!words.some((word) => word.speaker)) return [segment];
  const runs: RawWord[][] = [];
  let current = words[0].speaker ?? segment.speaker;
  for (const word of words) {
    const speaker = word.speaker ?? current;
    if (!runs.length || speaker !== current) runs.push([]);
    current = speaker;
    runs[runs.length - 1].push(speaker === word.speaker ? word : { ...word, speaker });
  }
  if (runs.length < 2) return [{ ...segment, speaker: segment.speaker ?? runs[0]?.[0]?.speaker }];
  return runs.map((run, index) => ({
    start: index === 0 ? segment.start : run[0].start,
    end: index === runs.length - 1 ? segment.end : Math.max(run.at(-1)!.end, runs[index + 1][0].start),
    text: joinWords(run),
    speaker: run[0].speaker,
    words: run,
  }));
}

function parseRoot(body: unknown): Row {
  let value = body;
  if (typeof body === "string") {
    try {
      value = JSON.parse(body);
    } catch {
      throw new Error("The transcription server's reply was not JSON.");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The transcription server's reply was not readable.");
  return value as Row;
}

/** Sorted, validated segments from any supported reply. An empty reply gives no segments. */
export function parseTranscriptionReply(body: unknown): ParsedTranscription {
  const root = parseRoot(body);
  const words = rawWords(root.words);
  let raw = Array.isArray(root.segments)
    ? attachWords([...rawSegments(root.segments)].sort((a, b) => a.start - b.start), words)
    : Array.isArray(root.transcription)
      ? whisperCppCliSegments(root.transcription)
      : segmentsFromWords(words);
  const duration = isTime(root.duration) ? root.duration : 0;
  if (!raw.length && typeof root.text === "string" && root.text.trim() && duration > 0) {
    raw = [{ start: 0, end: duration, text: root.text }];
  }
  raw = raw.flatMap(splitBySpeaker);
  if (raw.length > TRANSCRIPT_SEGMENT_LIMIT) throw new Error(segmentLimitMessage(raw.length));
  const segments = whisperJsonSegments({ segments: raw });
  segments.sort((a, b) => a.startSec - b.startSec);
  const labels = new Set(raw.map((segment) => segment.speaker).filter((label): label is string => Boolean(label)));
  return {
    segments,
    durationSec: Math.max(duration, ...segments.map((segment) => segment.endSec), 0),
    language: typeof root.language === "string" && root.language.trim() ? root.language.trim().slice(0, 40) : undefined,
    speakerCount: labels.size,
  };
}

// --- Long recordings in parts -------------------------------------------------

export type TranscriptionPart = { offsetSec: number; segments: readonly TranscriptSegment[] };

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

function shift(segment: TranscriptSegment, offsetSec: number): TranscriptSegment {
  const moved: TranscriptSegment = { ...segment, startSec: ms(segment.startSec + offsetSec), endSec: ms(segment.endSec + offsetSec) };
  if (segment.words) moved.words = segment.words.map((word) => ({ ...word, startSec: ms(word.startSec + offsetSec), endSec: ms(word.endSec + offsetSec) }));
  return moved;
}

const comparable = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/** A line heard in both parts: it starts inside the previous line and repeats its words. */
function repeatsPrevious(previous: TranscriptSegment, next: TranscriptSegment) {
  if (next.startSec >= previous.endSec) return false;
  const words = comparable(next.text);
  return Boolean(words) && comparable(previous.text).includes(words);
}

/**
 * Shifts each part to its place in the recording and keeps the overlap once:
 * each side of a boundary keeps the lines that start on its half of the
 * overlap, and a straddling line repeated by the next part is dropped.
 */
export function mergeTranscriptionParts(parts: readonly TranscriptionPart[], overlapSec = SPEECH_CHUNK_OVERLAP_SECONDS): TranscriptSegment[] {
  const sorted = [...parts].sort((a, b) => a.offsetSec - b.offsetSec);
  const merged: TranscriptSegment[] = [];
  sorted.forEach((part, index) => {
    const from = index === 0 ? -Infinity : part.offsetSec + overlapSec / 2;
    const until = index + 1 < sorted.length ? sorted[index + 1].offsetSec + overlapSec / 2 : Infinity;
    const boundary = merged.at(-1);
    let first = true;
    for (const segment of part.segments) {
      const moved = shift(segment, part.offsetSec);
      if (moved.startSec < from || moved.startSec >= until) continue;
      if (first && boundary && repeatsPrevious(boundary, moved)) continue;
      first = false;
      merged.push(moved);
    }
  });
  return merged.sort((a, b) => a.startSec - b.startSec);
}

export function segmentLimitMessage(count: number) {
  return `The transcription has ${count.toLocaleString("en-US")} lines; a transcript holds at most 20,000. Transcribe a shorter recording.`;
}

/** Checks the merged result against the transcript row's rules before it is saved. */
export function finishTranscription(segments: TranscriptSegment[], durationSec: number) {
  if (!segments.length) throw new Error("No speech was recognized in this recording.");
  if (segments.length > TRANSCRIPT_SEGMENT_LIMIT) throw new Error(segmentLimitMessage(segments.length));
  validateTranscriptSegments(segments);
  const end = segments.reduce((max, segment) => Math.max(max, segment.endSec), 0);
  return { segments, durationSeconds: Math.max(end, Number.isFinite(durationSec) ? durationSec : 0) };
}
