/**
 * Ranged download of a stored meeting source through the transfer broker.
 *
 * The broker returns successive MEETING_SOURCE_CHUNK_BYTES ranges, each hashed
 * against the committed digest before delivery. This loop only asks for the
 * next offset and refuses any range whose length is not exactly what was
 * requested, so a truncated or padded response never becomes part of a file.
 * It has no browser or broker dependencies so scripts can drive it with a
 * mocked fetch.
 */
import { MEETING_SOURCE_CHUNK_BYTES } from "../../shared/storage/meetingSourceProtocol";

export type MeetingSourceRangeFetch = (offset: number, signal?: AbortSignal) => Promise<Response>;

export type MeetingSourceDownloadOptions = {
  fetchRange: MeetingSourceRangeFetch;
  signal?: AbortSignal;
  /** Receives each verified range in order. */
  onPart: (part: Blob, offset: number) => Promise<void> | void;
  onProgress?: (received: number, total: number) => void;
};

export async function downloadMeetingSourceRanges(size: number, options: MeetingSourceDownloadOptions) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("Invalid file size.");
  let received = 0;
  for (let offset = 0; offset < size; offset += MEETING_SOURCE_CHUNK_BYTES) {
    options.signal?.throwIfAborted();
    const response = await options.fetchRange(offset, options.signal);
    if (!response.ok) throw new Error("Download failed.");
    const part = await response.blob();
    options.signal?.throwIfAborted();
    if (part.size !== Math.min(MEETING_SOURCE_CHUNK_BYTES, size - offset)) throw new Error("Incomplete download.");
    await options.onPart(part, offset);
    received += part.size;
    options.onProgress?.(received, size);
  }
}

/** Download every range into memory and return one Blob of the given type. */
export async function downloadMeetingSourceBlob(
  size: number,
  type: string,
  options: Omit<MeetingSourceDownloadOptions, "onPart">,
): Promise<Blob> {
  const parts: Blob[] = [];
  await downloadMeetingSourceRanges(size, { ...options, onPart: (part) => void parts.push(part) });
  return new Blob(parts, { type });
}

const RECORDING_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  wma: "audio/x-ms-wma",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

/** MIME type for a recording file name; the broker serves ranges as opaque bytes. */
export function meetingRecordingMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return RECORDING_TYPES[extension] ?? "application/octet-stream";
}
