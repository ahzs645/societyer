/** Decimal MB in the UI; chunks are sixteen Microsoft 320 KiB blocks. */
export const MEETING_SOURCE_MAX_BYTES = 500_000_000;
export const MEETING_SOURCE_CHUNK_BYTES = 5 * 1024 * 1024;
export const MEETING_TRANSCRIPT_MAX_BYTES = 600_000;
export type MeetingSourceKind = "transcript" | "recording" | "archive";

export function meetingSourceKind(name: string): MeetingSourceKind {
  const extension = name.toLowerCase().split(".").pop();
  if (["txt", "vtt", "srt", "json"].includes(extension ?? "")) return "transcript";
  if (extension === "zip") return "archive";
  if (["mp3", "mp4", "m4a", "wav", "webm", "ogg", "oga", "flac", "aac", "mov", "mkv", "wma"].includes(extension ?? "")) return "recording";
  throw new Error("Choose TXT, VTT, SRT, Whisper JSON/ZIP, or an audio/video recording.");
}

export function validateMeetingSource(name: string, size: number) {
  if (!name || name.length > 240 || /[\x00-\x1f/\\]/.test(name)) throw new Error("Invalid file name.");
  if (!Number.isSafeInteger(size) || size < 1 || size > MEETING_SOURCE_MAX_BYTES) throw new Error("Files must be between 1 byte and 500 MB.");
  return meetingSourceKind(name);
}

export function validateTransferUrl(value: string, hosts: readonly string[]): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.includes(url.hostname.toLowerCase())) throw new Error("Transfer host is outside the approved storage connection.");
  return url.href;
}

export function nextUploadOffset(ranges: unknown, total: number): number {
  if (!Array.isArray(ranges) || ranges.length !== 1 || typeof ranges[0] !== "string") throw new Error("Unexpected upload ranges.");
  const match = /^(\d+)-(\d*)$/.exec(ranges[0]);
  if (!match) throw new Error("Unexpected upload range.");
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total || (match[2] && Number(match[2]) !== total - 1)) throw new Error("Invalid upload offset.");
  return offset;
}
