/**
 * WORKING TRANSCRIPT → WebVTT, SRT OR WHISPER-STYLE JSON (pure, no DOM).
 *
 * The Transcript tab's Export menu. Each file carries the speakers as shown:
 * combined labels resolve to their target and assigned names replace raw
 * `SPEAKER_n` labels (`speakerResolver`). Every format re-imports through
 * `parseTimedTranscript` → `transcripts:importTimed`, which is how a transcript
 * made on the desktop app or in a browser-local workspace moves to the hosted
 * site:
 *
 * - WebVTT: `HH:MM:SS.mmm` cues, `<v Name>` voice tags, `&`, `<` and `>`
 *   escaped. Segment timings and speakers round-trip; word timings don't.
 * - SRT: numbered `HH:MM:SS,mmm` cues, `Name: ` prefixes, CRLF line ends.
 *   The importer only reads a prefix as a speaker when it looks like a name
 *   (at most four words, no digits or sentence punctuation) and repeats, so
 *   prefer VTT or JSON to move a transcript.
 * - Whisper JSON: `segments[]` with `start`, `end`, `text`, `speaker` and, when
 *   the transcript has them, `words[]` (`word`, `start`, `end`). The only format
 *   that keeps word timings. No top-level `text`, so a Meeting source files
 *   upload reads the lines with their speakers.
 *
 * In camera (decision A2): with the in-camera ranges given, each run of
 * segments overlapping one becomes a single "[In-camera session — not shown]"
 * cue (`redactInCameraTranscript`). Which ranges to pass, and whether to warn,
 * is the caller's choice (`inCameraExportRanges`).
 */
import {
  IN_CAMERA_TITLE,
  IN_CAMERA_TRANSCRIPT_LINE,
  redactInCameraTranscript,
  type InCameraRecordingRange,
} from "./minutesPrivacy";
import {
  normalizeTranscriptText,
  speakerResolver,
  TIMED_TRANSCRIPT_FILE_LIMIT,
  type TranscriptSegment,
  type TranscriptSpeaker,
  type TranscriptWord,
} from "./transcriptModel";

export const TRANSCRIPT_EXPORT_FORMATS = [
  { id: "vtt", label: "WebVTT", extension: "vtt", mime: "text/vtt;charset=utf-8" },
  { id: "srt", label: "SRT", extension: "srt", mime: "application/x-subrip;charset=utf-8" },
  { id: "json", label: "Whisper JSON", extension: "json", mime: "application/json;charset=utf-8" },
] as const;
/** Text is downloadable, but unlike these three caption formats is not a timed round trip. */
export const TRANSCRIPT_DOWNLOAD_FORMATS = [
  ...TRANSCRIPT_EXPORT_FORMATS,
  { id: "txt", label: "Plain text", extension: "txt", mime: "text/plain;charset=utf-8" },
] as const;
export type TranscriptExportFormat = (typeof TRANSCRIPT_DOWNLOAD_FORMATS)[number]["id"];

export type ExportableTranscript = {
  segments: readonly TranscriptSegment[];
  speakers?: readonly TranscriptSpeaker[];
  language?: string;
};

/**
 * The Export menu's hint for a format. Only Whisper JSON keeps word timings,
 * so it promises them only when this transcript has some.
 */
export function transcriptExportHint(format: TranscriptExportFormat, transcript: Pick<ExportableTranscript, "segments">): string {
  switch (format) {
    case "txt":
      return "Speaker names and text (no timings)";
    case "vtt":
      return "Names and timings";
    case "srt":
      return "“Name:” before each line";
    case "json":
      return transcript.segments.some((segment) => segment.words?.length) ? "Includes word timings" : "Segments with timings";
  }
}

/** One line of an export, with the speaker as shown. `inCamera` marks the placeholder. */
export type ExportCue = {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  words?: TranscriptWord[];
  inCamera?: true;
};

type RedactableSegment = TranscriptSegment & { inCameraRedacted?: boolean };

/** Segments with resolved speaker names, in-camera runs replaced when `inCameraRanges` is not empty. */
export function exportCues(
  transcript: ExportableTranscript,
  inCameraRanges: readonly InCameraRecordingRange[] = [],
): ExportCue[] {
  const source: { segments: RedactableSegment[]; speakers: TranscriptSpeaker[] } = {
    segments: [...transcript.segments],
    speakers: [...(transcript.speakers ?? [])],
  };
  const visible = inCameraRanges.length ? redactInCameraTranscript(source, inCameraRanges) : source;
  const resolver = speakerResolver(visible.speakers);
  return visible.segments.map((segment): ExportCue => {
    const { startSec, endSec } = segment;
    if (segment.inCameraRedacted)
      return { speaker: IN_CAMERA_TITLE, text: IN_CAMERA_TRANSCRIPT_LINE, startSec, endSec, inCamera: true };
    const speaker = normalizeTranscriptText(resolver.name(segment.speaker)) || "Speaker";
    const words = segment.words?.map((word) => ({ ...word }));
    return { speaker, text: segment.text, startSec, endSec, ...(words?.length ? { words } : {}) };
  });
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");
const milliseconds = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

/** `HH:MM:SS.mmm` (WebVTT) or `HH:MM:SS,mmm` (SRT); hours grow past 99 if they must. */
export function captionTimestamp(seconds: number, separator: "." | ","): string {
  const total = milliseconds(seconds);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const secs = Math.floor(total / 1000) % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}${separator}${pad(total % 1000, 3)}`;
}

/** Caption cues must end after they start; a zero-length line gets one millisecond. */
function cueTiming(cue: ExportCue, separator: "." | ","): string {
  const start = milliseconds(cue.startSec);
  const end = Math.max(milliseconds(cue.endSec), start + 1);
  return `${captionTimestamp(start / 1000, separator)} --> ${captionTimestamp(end / 1000, separator)}`;
}

/** WebVTT cue text and voice names: `&`, `<` and `>` as character references (this also keeps `-->` out). */
export function escapeVttText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toWebVtt(cues: readonly ExportCue[]): string {
  const blocks = cues.map(
    (cue) => `${cueTiming(cue, ".")}\n<v ${escapeVttText(cue.speaker)}>${escapeVttText(cue.text)}`,
  );
  return `WEBVTT\n\n${blocks.map((block) => `${block}\n`).join("\n")}`;
}

export function toSrt(cues: readonly ExportCue[]): string {
  return cues
    .map((cue, index) => {
      // The placeholder stands alone: "In-camera session: [In-camera session — not shown]" says it twice.
      const line = cue.inCamera ? cue.text : `${cue.speaker}: ${cue.text}`;
      return `${index + 1}\r\n${cueTiming(cue, ",")}\r\n${line}\r\n`;
    })
    .join("\r\n");
}

const seconds = (value: number) => milliseconds(value) / 1000;

export function toWhisperJson(cues: readonly ExportCue[], language?: string): string {
  const segments = cues.map((cue, id) => ({
    id,
    start: seconds(cue.startSec),
    end: seconds(cue.endSec),
    text: cue.text,
    speaker: cue.speaker,
    ...(cue.words?.length
      ? { words: cue.words.map((word) => ({ word: word.text, start: seconds(word.startSec), end: seconds(word.endSec) })) }
      : {}),
  }));
  const duration = segments.reduce((max, segment) => Math.max(max, segment.end), 0);
  return `${JSON.stringify({ ...(language ? { language } : {}), duration, segments }, null, 2)}\n`;
}

export type TranscriptExportFile = {
  fileName: string;
  mime: string;
  content: string;
  /** Lines in the file, the in-camera placeholders included. */
  cueCount: number;
  /** In-camera placeholder lines. */
  inCameraCount: number;
  /** Over the 16 MB a timed transcript import accepts. */
  tooLargeToImport: boolean;
};

/**
 * "Board meeting — 2026-10-06" on 2026-10-06 as `vtt`: `board-meeting-2026-10-06.vtt`.
 * Letters and digits of any script are kept; everything else becomes one dash.
 */
export function transcriptExportFileName(
  title: string | undefined,
  date: string | undefined,
  format: TranscriptExportFormat,
): string {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  let base = (title ?? "").normalize("NFKC");
  if (day && base.trim().endsWith(day)) base = base.trim().slice(0, -day.length);
  const slug = base
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "") || "meeting-transcript";
  const extension = TRANSCRIPT_DOWNLOAD_FORMATS.find((entry) => entry.id === format)?.extension ?? format;
  return `${slug}${day ? `-${day}` : ""}.${extension}`;
}

export function exportTranscript(
  transcript: ExportableTranscript,
  format: TranscriptExportFormat,
  options: { title?: string; date?: string; inCameraRanges?: readonly InCameraRecordingRange[] } = {},
): TranscriptExportFile {
  const cues = exportCues(transcript, options.inCameraRanges);
  const content =
    format === "vtt" ? toWebVtt(cues) : format === "srt" ? toSrt(cues)
      : format === "txt" ? cues.map((cue) => cue.inCamera ? cue.text : `${cue.speaker}: ${cue.text}`).join("\n") + "\n"
      : toWhisperJson(cues, transcript.language);
  const entry = TRANSCRIPT_DOWNLOAD_FORMATS.find((candidate) => candidate.id === format);
  return {
    fileName: transcriptExportFileName(options.title, options.date, format),
    mime: entry?.mime ?? "text/plain;charset=utf-8",
    content,
    cueCount: cues.length,
    inCameraCount: cues.filter((cue) => cue.inCamera).length,
    tooLargeToImport: new TextEncoder().encode(content).byteLength > TIMED_TRANSCRIPT_FILE_LIMIT,
  };
}
