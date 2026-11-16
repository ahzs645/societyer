import {
  normalizeTranscriptText,
  TIMED_TRANSCRIPT_FILE_LIMIT,
  validateTranscriptSegments,
} from "../../../../shared/transcriptModel";
import type { TranscriptSegment } from "../../../../shared/transcriptModel";
import { whisperJsonSegments } from "../../../../shared/ai/transcription";
import { TIMED_TRANSCRIPT_FORMAT_LABEL, type TimedTranscriptProvider } from "../../../../shared/transcriptFormats";
export type {
  TranscriptSegment,
  TranscriptSpeaker,
  TranscriptWord,
} from "../../../../shared/transcriptModel";
export type TimedTranscript = {
  provider: TimedTranscriptProvider;
  segments: TranscriptSegment[];
  durationSeconds: number;
};

function timestamp(value: string) {
  if (!/^(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}$/.test(value))
    throw new Error(`Invalid caption timestamp: ${value}`);
  const parts = value.replace(",", ".").split(":").map(Number);
  const seconds = parts.pop()!;
  const minutes = parts.pop()!;
  if (seconds >= 60 || minutes >= 60) throw new Error(`Invalid caption timestamp: ${value}`);
  return number((parts[0] ?? 0) * 3600 + minutes * 60 + seconds);
}
/** Character references, `&amp;` last so `&amp;lt;` reads as the text `&lt;`. */
function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}
function cleanCaption(text: string) {
  return normalizeTranscriptText(decodeEntities(text.replace(/<[^>]+>/g, "")));
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Transcript times must be finite, non-negative numbers.");
  return value;
}
/** Whisper / WhisperX JSON; the rules are shared with on-device transcription. */
function whisperSegments(text: string): TranscriptSegment[] {
  return whisperJsonSegments(JSON.parse(text) as unknown);
}

type Cue = {
  startSec: number;
  endSec: number;
  body: string;
  voice?: string;
  prefix?: string;
  remainder?: string;
};

/** A "Name: text" prefix that reads like a speaker, not a sentence ("Note: we…" still needs repeats). */
function speakerPrefix(body: string): { prefix: string; remainder: string } | undefined {
  const match = body.match(/^([^:]{1,40}):\s*(.+)$/);
  if (!match) return undefined;
  const prefix = normalizeTranscriptText(match[1].replace(/^>>\s*/, ""));
  const eligible = prefix && prefix.split(" ").length <= 4 && !/[.,?!]/.test(prefix) && !/\b\d+\b/.test(prefix);
  return eligible ? { prefix, remainder: match[2] } : undefined;
}

function cue(startSec: number, endSec: number, payload: string, voiceTag = true): Cue | null {
  const rawVoice = voiceTag ? payload.match(/<v(?:\.[^ >]+)?\s+([^>]+)>/i)?.[1] : undefined;
  const voice = (rawVoice && normalizeTranscriptText(decodeEntities(rawVoice))) || undefined;
  const body = cleanCaption(payload).replace(/^>>\s*/, "");
  if (!body) return null;
  return { startSec, endSec, body, voice, ...(!voice ? speakerPrefix(body) : {}) };
}

function pushCue(cues: Cue[], next: Cue | null) {
  if (!next) return;
  cues.push(next);
  if (cues.length > 20_000) throw new Error("Use at most 20,000 transcript segments.");
}

/**
 * Explicit voices and repeated prefixes are speaker evidence for the whole
 * file; a one-off "Note:" stays part of the text.
 */
function segmentsFromCues(cues: readonly Cue[]): TranscriptSegment[] {
  const counts = new Map<string, number>();
  for (const cue of cues) {
    if (cue.prefix) counts.set(cue.prefix, (counts.get(cue.prefix) ?? 0) + 1);
  }
  const hasSpeakerInfo = cues.some((cue) => cue.voice) || [...counts.values()].some((count) => count >= 2);
  return cues.map((cue) => {
    const usePrefix = cue.prefix && ((counts.get(cue.prefix) ?? 0) >= 2 || !hasSpeakerInfo);
    return {
      speaker: normalizeTranscriptText(cue.voice ?? (usePrefix ? cue.prefix! : "Speaker")),
      text: usePrefix ? normalizeTranscriptText(cue.remainder!) : cue.body,
      startSec: cue.startSec,
      endSec: cue.endSec,
    };
  });
}

/** WebVTT and SubRip. */
function captionSegments(text: string): TranscriptSegment[] {
  const cues: Cue[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(NOTE|STYLE|REGION)\b/i.test(line)) {
      while (i + 1 < lines.length && lines[i + 1].trim()) i++;
      continue;
    }
    if (!line.includes("-->")) continue;
    const match = line.match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if (!match) throw new Error("Invalid caption cue.");
    const startSec = timestamp(match[1]);
    const endSec = timestamp(match[2]);
    if (endSec < startSec) throw new Error("Cue times must start before they end.");
    const payload: string[] = [];
    while (i + 1 < lines.length && lines[i + 1].trim()) payload.push(lines[++i]);
    pushCue(cues, cue(startSec, endSec, payload.join(" ")));
  }
  return segmentsFromCues(cues);
}

/** SubViewer (YouTube): `0:00:01.000,0:00:04.000` then the caption lines. */
function sbvTimestamp(value: string) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})\.(\d{1,3})$/.exec(value);
  if (!match) throw new Error(`Invalid caption timestamp: ${value}`);
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (minutes >= 60 || seconds >= 60) throw new Error(`Invalid caption timestamp: ${value}`);
  return number(hours * 3600 + minutes * 60 + seconds + Number(`0.${match[4]}`));
}
const SBV_CUE = /^(\d{1,3}:\d{2}:\d{2}\.\d{1,3}),(\d{1,3}:\d{2}:\d{2}\.\d{1,3})$/;
function sbvSegments(text: string): TranscriptSegment[] {
  const cues: Cue[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = SBV_CUE.exec(lines[i].trim());
    if (!match) continue;
    const startSec = sbvTimestamp(match[1]);
    const endSec = sbvTimestamp(match[2]);
    if (endSec < startSec) throw new Error("Cue times must start before they end.");
    const payload: string[] = [];
    while (i + 1 < lines.length && lines[i + 1].trim()) payload.push(lines[++i]);
    // SBV has no voice tags; "[Music]"-style cues are kept as text.
    pushCue(cues, cue(startSec, endSec, payload.join(" "), false));
  }
  if (!cues.length) throw new Error("No SBV caption cues were found.");
  return segmentsFromCues(cues);
}

/**
 * A clock offset in a text transcript: `5:07`, `00:05:07`, `1:02:03.250`.
 * Without hours the minutes may run past 59 (`75:12`), as Otter writes them.
 */
const CLOCK = String.raw`(?:\d{1,2}:)?\d{1,3}:\d{2}(?:[.,]\d{1,3})?`;
function clockSeconds(value: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(value);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (seconds >= 60 || (match[1] && minutes >= 60)) return null;
  return hours * 3600 + minutes * 60 + seconds + (match[4] ? Number(`0.${match[4]}`) : 0);
}
/** `00:05`, `[00:05]`, `(00:05)` alone on a line (Google Meet). */
const TIME_ONLY = new RegExp(`^[\\[(]?(${CLOCK})[\\])]?$`);
/** `[00:05] text`, `(00:05) text`, `00:05 - text`, `00:05 text` (Descript, many exports). */
const TIME_FIRST = new RegExp(`^(?:[\\[(](${CLOCK})[\\])]\\s*|(${CLOCK})(?:\\s*[-–—|]\\s*|\\s+))(\\S.*)$`);
/** `Name  0:05`, `Name (00:05):`, `Name [00:00:05]` after a blank line (Otter, Rev, Teams). */
const NAME_THEN_TIME = new RegExp(`^(.{1,60}?)\\s*(?:[\\[(](${CLOCK})[\\])]|\\s(${CLOCK}))\\s*:?$`);

/** Speaking pace used to end the last line when nothing follows it. */
const WORDS_PER_SECOND = 2.5;

function headerSpeaker(raw: string): string | undefined {
  const name = normalizeTranscriptText(raw.replace(/^[[(]|[\])]$/g, "").replace(/[:\-–—|]+$/, ""));
  if (!name || name.split(" ").length > 5 || /[.?!]$/.test(name) || /^\d/.test(name)) return undefined;
  return name;
}

type TextBlock = { startSec: number; speaker?: string; lines: string[] };

/**
 * Text transcripts with timestamps: a timestamp before each turn or block.
 * Turns inside one timestamped block (Google Meet writes one timestamp every
 * few minutes) share its time span, split by length. A file with fewer than
 * two timestamps is not a timed transcript.
 */
function timestampedTextSegments(text: string): TranscriptSegment[] {
  const blocks: TextBlock[] = [];
  let afterBlank = true;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { afterBlank = true; continue; }
    const wasAfterBlank = afterBlank;
    afterBlank = false;
    const only = TIME_ONLY.exec(line);
    if (only) { blocks.push({ startSec: clockSeconds(only[1])!, lines: [] }); continue; }
    const first = TIME_FIRST.exec(line);
    const firstSec = first ? clockSeconds(first[1] ?? first[2]) : null;
    if (first && firstSec !== null) { blocks.push({ startSec: firstSec, lines: [first[3]] }); continue; }
    const header = wasAfterBlank ? NAME_THEN_TIME.exec(line) : null;
    const headerSec = header ? clockSeconds(header[2] ?? header[3]) : null;
    const speaker = header ? headerSpeaker(header[1]) : undefined;
    if (header && headerSec !== null && speaker) { blocks.push({ startSec: headerSec, speaker, lines: [] }); continue; }
    // Text before the first timestamp is a title or date line; drop export footers.
    if (/^transcribed by\b/i.test(line)) continue;
    blocks.at(-1)?.lines.push(line);
  }
  if (blocks.length < 2) throw new Error("This text file has no timestamps. Import it as a plain transcript instead.");
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].startSec < blocks[i - 1].startSec)
      throw new Error("Timestamps in this text file go backwards, so it can't be read as a timed transcript.");
  }

  const cues: Cue[] = [];
  blocks.forEach((block, index) => {
    const lines = block.lines.map(normalizeTranscriptText).filter(Boolean);
    if (!lines.length) return;
    // Turns in the block: a named header is one turn; otherwise each "Name:" line starts one.
    const turns: { body: string; voice?: string }[] = [];
    if (block.speaker) turns.push({ body: lines.join(" "), voice: block.speaker });
    else for (const line of lines) {
      if (!turns.length || speakerPrefix(line)) turns.push({ body: line });
      else turns[turns.length - 1].body += ` ${line}`;
    }
    const next = blocks.slice(index + 1).find((later) => later.startSec > block.startSec);
    const words = turns.reduce((sum, turn) => sum + turn.body.split(" ").length, 0);
    const blockEnd = next ? next.startSec : block.startSec + Math.max(1, Math.round(words / WORDS_PER_SECOND));
    const span = blockEnd - block.startSec;
    const total = turns.reduce((sum, turn) => sum + turn.body.length, 0);
    let start = block.startSec;
    let used = 0;
    turns.forEach((turn, turnIndex) => {
      used += turn.body.length;
      const end = turnIndex === turns.length - 1 ? blockEnd : block.startSec + Math.round((span * used / total) * 1000) / 1000;
      pushCue(cues, {
        startSec: number(start),
        endSec: number(Math.max(start, end)),
        body: turn.body,
        voice: turn.voice,
        ...(!turn.voice ? speakerPrefix(turn.body) : {}),
      });
      start = Math.max(start, end);
    });
  });
  if (!cues.length) throw new Error("This text file has timestamps but no transcript text.");
  return segmentsFromCues(cues);
}

export function parseTimedTranscript(fileName: string, text: string): TimedTranscript {
  if (new TextEncoder().encode(text).byteLength > TIMED_TRANSCRIPT_FILE_LIMIT)
    throw new Error("Timed transcript files must be 16 MB or smaller.");
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const extension = fileName.toLowerCase().split(".").pop();
  const provider: TimedTranscript["provider"] | null =
    extension === "json" ? "whisper-json"
    : extension === "srt" ? "srt"
    : extension === "vtt" ? "vtt"
    : extension === "sbv" ? "sbv"
    : extension === "txt" ? "timestamped-text"
    : null;
  if (!provider) throw new Error(`Choose a ${TIMED_TRANSCRIPT_FORMAT_LABEL} file.`);
  const segments =
    provider === "whisper-json" ? whisperSegments(text)
    : provider === "sbv" ? sbvSegments(text)
    : provider === "timestamped-text" ? timestampedTextSegments(text)
    : captionSegments(text);
  // Modern Array.sort is stable, including equal-start overlapping Teams cues.
  segments.sort((a, b) => a.startSec - b.startSec);
  validateTranscriptSegments(segments);
  return {
    provider,
    segments,
    durationSeconds: segments.reduce((max, segment) => Math.max(max, segment.endSec), 0),
  };
}
