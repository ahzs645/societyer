/**
 * Resumable upload of one meeting source through the transfer broker.
 *
 * The browser fingerprints the whole file first (a SHA-256 of every 5 MiB
 * chunk, then of the ordered manifest and file metadata), so "start" finds an
 * interrupted upload of the same complete file and resumes it. The server owns
 * the offset: each chunk is sent at the offset the broker last acknowledged,
 * never at a client-side progress count. After the last chunk the broker reads
 * every range back from storage and compares it with the digest it computed on
 * the way in ("verify") before the source becomes "ready".
 *
 * Like meetingSourceDownload, this has no browser or broker dependencies, so
 * scripts can drive it against the real transfer Worker.
 */
import { MEETING_SOURCE_CHUNK_BYTES, validateMeetingSource } from "../../shared/storage/meetingSourceProtocol";

export type MeetingSource = {
  id: string;
  fileName: string;
  size: number;
  kind: string;
  status: string;
  offset: number;
  verifiedOffset: number;
  textChunks?: number;
  textBytes?: number;
  textComplete?: boolean;
  transcriptImported?: boolean;
  jobStatus?: string;
  jobError?: string;
};

/** The broker operations an upload uses; each resolves to the server's view of the source. */
export type MeetingSourceTransport = {
  request: (operation: "start" | "resume" | "verify", data: Record<string, unknown>, signal?: AbortSignal) => Promise<MeetingSource>;
  putChunk: (sourceId: string, offset: number, body: Blob, signal?: AbortSignal) => Promise<MeetingSource>;
};

/** Hash every chunk, then the manifest: resuming requires the same complete file. */
export async function sourceFingerprint(file: Blob & { name: string }, signal?: AbortSignal) {
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += MEETING_SOURCE_CHUNK_BYTES) {
    signal?.throwIfAborted();
    hashes.push(await sha256Hex(await file.slice(offset, offset + MEETING_SOURCE_CHUNK_BYTES).arrayBuffer()));
  }
  return sha256Hex(new TextEncoder().encode(JSON.stringify({ name: file.name, size: file.size, hashes })).buffer);
}

async function sha256Hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function uploadMeetingSourceWith(
  transport: MeetingSourceTransport,
  file: Blob & { name: string },
  meetingId: string,
  progress: (source: MeetingSource) => void,
  signal: AbortSignal,
) {
  validateMeetingSource(file.name, file.size);
  const fingerprint = await sourceFingerprint(file, signal);
  let state = await transport.request("start", { meetingId, fileName: file.name, size: file.size, fingerprint }, signal);
  progress(state);
  state = await transport.request("resume", { sourceId: state.id }, signal);
  while (state.status === "uploading" && state.offset < file.size) {
    signal.throwIfAborted();
    const size = Math.min(MEETING_SOURCE_CHUNK_BYTES, file.size - state.offset);
    state = await transport.putChunk(state.id, state.offset, file.slice(state.offset, state.offset + size), signal);
    progress(state);
  }
  while (state.status === "verifying") {
    signal.throwIfAborted();
    state = await transport.request("verify", { sourceId: state.id }, signal);
    progress(state);
  }
  if (state.status !== "ready") throw new Error("Upload is incomplete. Choose the same file to resume.");
  return state;
}
