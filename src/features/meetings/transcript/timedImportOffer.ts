import { TIMED_TRANSCRIPT_FILE_LIMIT } from "../../../../shared/transcriptModel";
import { crc32, openZip, readZipEntryBytes } from "../../../lib/zipStream";
import { parseTimedTranscript, type TimedTranscript } from "./timedTranscript";

/** Shared by the Transcript tab import and the Meeting source files offer. */
export const REPLACE_TRANSCRIPT_CONFIRM = {
  title: "Replace working transcript?",
  message:
    "This replaces the working transcript, its segment edits and speaker assignments. Approved minutes stay unchanged.",
  confirmLabel: "Replace transcript",
  tone: "danger",
} as const;

/** `?intent=` value that opens Review speakers when the Transcript tab loads. */
export const REVIEW_SPEAKERS_INTENT = "review-speakers";

const TIMED_FILE = /\.(vtt|srt|json)$/i;
// Richer formats first: Whisper JSON carries speakers and word timings.
const zipRank = (name: string) => (/\.json$/i.test(name) ? 0 : /\.vtt$/i.test(name) ? 1 : 2);
const MAX_ZIP_ATTEMPTS = 5;

/**
 * A timed transcript found in an uploaded source file, for "Open in Transcript
 * tab". Returns null when the file is not a timed format, is over 16 MB, or
 * does not parse, so the caller keeps the plain paged-text import only.
 */
export async function timedTranscriptOffer(
  file: Blob & { name: string },
): Promise<(TimedTranscript & { fileName: string }) | null> {
  if (TIMED_FILE.test(file.name)) {
    if (file.size > TIMED_TRANSCRIPT_FILE_LIMIT) return null;
    return parseOrNull(file.name, await file.text());
  }
  if (!/\.zip$/i.test(file.name)) return null;
  try {
    const entries = [...(await openZip(file)).values()]
      .filter(
        (entry) =>
          !entry.dir &&
          !(entry.flags & 1) &&
          TIMED_FILE.test(entry.name) &&
          entry.size <= TIMED_TRANSCRIPT_FILE_LIMIT &&
          !entry.name.startsWith("/") &&
          !entry.name.split("/").includes("..") &&
          !/(^|\/)(__MACOSX|\.)/.test(entry.name),
      )
      .sort((a, b) => zipRank(a.name) - zipRank(b.name) || a.name.localeCompare(b.name))
      .slice(0, MAX_ZIP_ATTEMPTS);
    for (const entry of entries) {
      let crc = 0;
      const bytes = await readZipEntryBytes(file, entry, (chunk) => {
        crc = crc32(chunk, crc);
      });
      if (crc !== entry.crc) continue;
      const parsed = parseOrNull(entry.name, new TextDecoder().decode(bytes));
      if (parsed) return parsed;
    }
  } catch {
    // An unreadable archive still gets the paged text import and stays attached.
  }
  return null;
}

function parseOrNull(fileName: string, text: string) {
  try {
    return { ...parseTimedTranscript(fileName, text), fileName };
  } catch {
    return null;
  }
}
