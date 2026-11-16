/**
 * Transcript file formats the meeting tools read, in one place so the file
 * pickers, the source-file upload, the plain-text import and the timed
 * import agree. Pure module.
 *
 * Timed formats become a `transcripts` row with segments (Transcript tab):
 *   - WebVTT (`.vtt`): Teams, Zoom, Google Meet and most caption exports.
 *   - SubRip (`.srt`): Premiere, Descript, Otter and most video editors.
 *   - SubViewer (`.sbv`): YouTube caption downloads.
 *   - Whisper / WhisperX JSON (`.json`).
 *   - Timestamped text (`.txt`): Otter ("Name  0:05"), Rev ("Name (00:05):"),
 *     Descript ("[00:00:05] Name: text"), Google Meet (a timestamp line
 *     followed by "Name: text" lines). A `.txt` with no timestamps is still a
 *     plain transcript; it just has no timings.
 */

/** Where a timed transcript came from (`transcripts.provider`). */
export const TIMED_TRANSCRIPT_PROVIDERS = [
  "vtt",
  "srt",
  "sbv",
  "timestamped-text",
  "whisper-json",
  "local-whisper",
] as const;
export type TimedTranscriptProvider = (typeof TIMED_TRANSCRIPT_PROVIDERS)[number];

export function isTimedTranscriptProvider(value: unknown): value is TimedTranscriptProvider {
  return (TIMED_TRANSCRIPT_PROVIDERS as readonly unknown[]).includes(value);
}

/** Extensions that can hold a timed transcript. */
export const TIMED_TRANSCRIPT_EXTENSIONS = ["vtt", "srt", "sbv", "json", "txt"] as const;
/** Extensions imported as transcript text under Meeting source files. */
export const TRANSCRIPT_SOURCE_EXTENSIONS = ["txt", "vtt", "srt", "sbv", "json"] as const;
/** Caption formats whose cue timing lines are dropped by the plain-text import. */
export const CAPTION_EXTENSIONS = ["vtt", "srt", "sbv"] as const;
export const RECORDING_EXTENSIONS = [
  "mp3", "mp4", "m4a", "wav", "webm", "ogg", "oga", "flac", "aac", "mov", "mkv", "wma",
] as const;

const extensionPattern = (extensions: readonly string[]) => new RegExp(`\\.(${extensions.join("|")})$`, "i");

export const TIMED_TRANSCRIPT_FILE = extensionPattern(TIMED_TRANSCRIPT_EXTENSIONS);
export const TRANSCRIPT_SOURCE_FILE = extensionPattern(TRANSCRIPT_SOURCE_EXTENSIONS);
export const CAPTION_FILE = extensionPattern(CAPTION_EXTENSIONS);

/** `accept` for a timed transcript picker. */
export const TIMED_TRANSCRIPT_ACCEPT = [
  ...TIMED_TRANSCRIPT_EXTENSIONS.map((extension) => `.${extension}`),
  "text/vtt",
  "application/json",
  "text/plain",
].join(",");

/** `accept` for Meeting source files: transcripts, archives and recordings. */
export const MEETING_SOURCE_ACCEPT = [...TRANSCRIPT_SOURCE_EXTENSIONS, "zip", ...RECORDING_EXTENSIONS]
  .map((extension) => `.${extension}`)
  .join(",");

/** Human list for help text and errors. */
export const TIMED_TRANSCRIPT_FORMAT_LABEL = "VTT, SRT, SBV, Whisper JSON or timestamped text";

/**
 * Preference when an archive holds several transcript files: the richest
 * timed format first (Whisper JSON carries speakers and word timings).
 */
export function timedTranscriptRank(name: string): number {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return 0;
  if (lower.endsWith(".vtt")) return 1;
  if (lower.endsWith(".srt")) return 2;
  if (lower.endsWith(".sbv")) return 3;
  return 4;
}
