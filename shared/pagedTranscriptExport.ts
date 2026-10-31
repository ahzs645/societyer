import type { ExportableTranscript } from "./transcriptExport";
import type { TranscriptSegment, TranscriptSpeaker } from "./transcriptModel";

export const TRANSCRIPT_EXPORT_BYTE_LIMIT = 64 * 1024 * 1024;
/** Load the complete transcript before applying the common export policy. Never emit a partial file. */
export async function loadPagedTranscript(options: {
  pageCount: number;
  speakers: readonly TranscriptSpeaker[];
  loadPage: (index: number) => Promise<{ segments: readonly TranscriptSegment[] }>;
  signal: AbortSignal;
  onProgress?: (message: string) => void;
  byteLimit?: number;
}): Promise<ExportableTranscript> {
  if (!Number.isSafeInteger(options.pageCount) || options.pageCount < 1 || options.pageCount > 10_000) throw new Error("Invalid transcript page count.");
  const segments: TranscriptSegment[] = [];
  const limit = options.byteLimit ?? TRANSCRIPT_EXPORT_BYTE_LIMIT;
  let bytes = 0;
  for (let index = 0; index < options.pageCount; index++) {
    options.signal.throwIfAborted();
    const page = await options.loadPage(index);
    options.signal.throwIfAborted();
    if (!page || !Array.isArray(page.segments)) throw new Error(`Transcript page ${index + 1} is unavailable. No file was exported.`);
    bytes += new TextEncoder().encode(JSON.stringify(page.segments)).byteLength;
    if (bytes > limit) throw new Error("This transcript exceeds the 64 MB export limit. No file was exported.");
    for (const segment of page.segments) segments.push(segment);
    options.onProgress?.(`Preparing export ${index + 1} of ${options.pageCount}…`);
  }
  return { segments, speakers: options.speakers };
}
