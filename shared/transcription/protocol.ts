export const TRANSCRIPTION_PROTOCOL = 1;
export const TRANSCRIPT_PAGE_SEGMENTS = 50;
export const TRANSCRIPT_PAGE_BYTES = 192_000;
export const TRANSCRIPT_MAX_SEGMENTS = 200_000;
export const TRANSCRIPTION_LEASE_MS = 120_000;
export type WhisperXSettings = { model: string; language: string; device: "cpu" | "cuda"; batchSize: number; diarize: boolean; minSpeakers?: number; maxSpeakers?: number };
export const DEFAULT_WHISPERX_SETTINGS: WhisperXSettings = { model: "small", language: "auto", device: "cpu", batchSize: 4, diarize: false };
export const WHISPERX_MODELS = ["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"];
export function validateWhisperXSettings(value: WhisperXSettings): WhisperXSettings {
  if (!WHISPERX_MODELS.includes(value.model) || !/^(auto|[a-z]{2,3})$/.test(value.language) || !["cpu", "cuda"].includes(value.device) || !Number.isInteger(value.batchSize) || value.batchSize < 1 || value.batchSize > 32 || typeof value.diarize !== "boolean") throw new Error("Choose supported WhisperX settings.");
  for (const count of [value.minSpeakers, value.maxSpeakers]) if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 32)) throw new Error("Speaker counts must be between 1 and 32.");
  if (value.minSpeakers && value.maxSpeakers && value.minSpeakers > value.maxSpeakers) throw new Error("Minimum speakers exceeds maximum speakers.");
  return value;
}
export type WhisperXSegment = { speaker: string; text: string; startSec: number; endSec: number; words?: { text: string; startSec: number; endSec: number }[] };
export function validateTranscriptPage(segments: WhisperXSegment[]) {
  if (!Array.isArray(segments) || !segments.length || segments.length > TRANSCRIPT_PAGE_SEGMENTS || new TextEncoder().encode(JSON.stringify(segments)).length > TRANSCRIPT_PAGE_BYTES) throw new Error("Transcript page is too large or empty.");
  let last = -1;
  for (const s of segments) {
    if (!s.text.trim() || s.text.length > 20_000 || !/^[A-Za-z0-9 _.-]{1,80}$/.test(s.speaker) || !Number.isFinite(s.startSec) || !Number.isFinite(s.endSec) || s.startSec < last || s.startSec < 0 || s.endSec < s.startSec || s.endSec > 86400) throw new Error("Invalid timed segment.");
    last = s.startSec;
    if (s.words && s.words.length > 2000) throw new Error("Too many words in a segment.");
    for (const w of s.words ?? []) if (!w.text || w.text.length > 1000 || !Number.isFinite(w.startSec) || !Number.isFinite(w.endSec) || w.startSec < Math.max(0, s.startSec - 1) || w.endSec < w.startSec || w.endSec > s.endSec + 1) throw new Error("Invalid word timing.");
  }
}
