import {
  normalizeTranscriptText,
  TIMED_TRANSCRIPT_FILE_LIMIT,
  validateTranscriptSegments,
} from "../../../../shared/transcriptModel";
import type { TranscriptSegment } from "../../../../shared/transcriptModel";
import { whisperJsonSegments } from "../../../../shared/ai/transcription";
export type {
  TranscriptSegment,
  TranscriptSpeaker,
  TranscriptWord,
} from "../../../../shared/transcriptModel";
export type TimedTranscript = {
  provider: "vtt" | "srt" | "whisper-json" | "local-whisper";
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
function cleanCaption(text: string) {
  return normalizeTranscriptText(
    text
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/gi, "&"),
  );
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

function captionSegments(text: string): TranscriptSegment[] {
  const cues: {
    startSec: number;
    endSec: number;
    body: string;
    voice?: string;
    prefix?: string;
    remainder?: string;
  }[] = [];
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
    const joined = payload.join(" ");
    const voice = joined.match(/<v(?:\.[^ >]+)?\s+([^>]+)>/i)?.[1];
    const body = cleanCaption(joined);
    const matchPrefix = !voice ? body.match(/^([^:]{1,40}):\s*(.+)$/) : null;
    const prefix = matchPrefix ? normalizeTranscriptText(matchPrefix[1]) : undefined;
    const eligible =
      prefix && prefix.split(" ").length <= 4 && !/[.,?!]/.test(prefix) && !/\b\d+\b/.test(prefix);
    if (body)
      cues.push({
        startSec,
        endSec,
        body,
        voice,
        ...(eligible ? { prefix, remainder: matchPrefix![2] } : {}),
      });
    if (cues.length > 20_000) throw new Error("Use at most 20,000 transcript segments.");
  }
  // Explicit voices and repeated prefixes provide speaker evidence for the whole file.
  const counts = new Map<string, number>();
  for (const cue of cues) {
    if (cue.prefix) counts.set(cue.prefix, (counts.get(cue.prefix) ?? 0) + 1);
  }
  const hasSpeakerInfo = cues.some((cue) => cue.voice) || [...counts.values()].some((count) => count >= 2);
  return cues.map((cue) => {
    const usePrefix = cue.prefix && ((counts.get(cue.prefix) ?? 0) >= 2 || !hasSpeakerInfo);
    return {
      speaker: normalizeTranscriptText(cue.voice ?? (usePrefix ? cue.prefix! : "Speaker")),
      text: usePrefix ? cue.remainder! : cue.body,
      startSec: cue.startSec,
      endSec: cue.endSec,
    };
  });
}

export function parseTimedTranscript(fileName: string, text: string): TimedTranscript {
  if (new TextEncoder().encode(text).byteLength > TIMED_TRANSCRIPT_FILE_LIMIT)
    throw new Error("Timed transcript files must be 16 MB or smaller.");
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const provider = /\.json$/i.test(fileName)
    ? "whisper-json"
    : /\.srt$/i.test(fileName)
      ? "srt"
      : /\.vtt$/i.test(fileName)
        ? "vtt"
        : null;
  if (!provider) throw new Error("Choose a VTT, SRT or Whisper JSON file.");
  const segments = provider === "whisper-json" ? whisperSegments(text) : captionSegments(text);
  // Modern Array.sort is stable, including equal-start overlapping Teams cues.
  segments.sort((a, b) => a.startSec - b.startSec);
  validateTranscriptSegments(segments);
  return {
    provider,
    segments,
    durationSeconds: segments.reduce((max, segment) => Math.max(max, segment.endSec), 0),
  };
}
