import { authenticatedFetch } from "./authToken";
import { MEETING_SOURCE_CHUNK_BYTES, validateMeetingSource } from "../../shared/storage/meetingSourceProtocol";
import type { MeetingSourceRangeFetch } from "./meetingSourceDownload";

export const meetingSourceBroker = String(import.meta.env.VITE_MEETING_SOURCE_BROKER_URL ?? "").replace(/\/$/, "");
export type MeetingSource = { id: string; fileName: string; size: number; kind: string; status: string; offset: number; verifiedOffset: number; textChunks?: number; textBytes?: number; textComplete?: boolean; transcriptImported?: boolean; jobStatus?: string; jobError?: string };

export async function sourceRequest(operation: string, data: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const response = await sourceFetch(operation, { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" }, signal });
  return response.json();
}

export async function sourceFetch(operation: string, init: RequestInit, query = "") {
  if (!/^(start|list|resume|cancel|chunk|verify|download)$/.test(operation)) throw new Error("Invalid file operation.");
  const base = new URL(meetingSourceBroker);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("File transfer is not configured.");
  const response = await authenticatedFetch(`${base.origin}/meeting-sources/${operation}${query}`, { ...init, redirect: "error" });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "File transfer failed. Sign in again or check access.");
  }
  return response;
}

/** Authenticated broker range requests for one stored source (see meetingSourceDownload). */
export function meetingSourceRangeFetcher(sourceId: string): MeetingSourceRangeFetch {
  return (offset, signal) => sourceFetch("download", { method: "POST", body: JSON.stringify({ sourceId, offset }), headers: { "Content-Type": "application/json" }, signal });
}

/** Hash every chunk, then the manifest: resuming requires the same complete file. */
export async function sourceFingerprint(file: File, signal?: AbortSignal) {
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += MEETING_SOURCE_CHUNK_BYTES) {
    signal?.throwIfAborted();
    hashes.push(await sha(await file.slice(offset, offset + MEETING_SOURCE_CHUNK_BYTES).arrayBuffer()));
  }
  return sha(new TextEncoder().encode(JSON.stringify({ name: file.name, size: file.size, hashes })).buffer);
}
async function sha(bytes: ArrayBuffer) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join(""); }

export async function uploadMeetingSource(file: File, meetingId: string, progress: (source: MeetingSource) => void, signal: AbortSignal) {
  validateMeetingSource(file.name, file.size);
  const fingerprint = await sourceFingerprint(file, signal);
  let state = await sourceRequest("start", { meetingId, fileName: file.name, size: file.size, fingerprint }, signal);
  progress(state);
  state = await sourceRequest("resume", { sourceId: state.id }, signal);
  while (state.status === "uploading" && state.offset < file.size) {
    signal.throwIfAborted();
    const size = Math.min(MEETING_SOURCE_CHUNK_BYTES, file.size - state.offset);
    const response = await sourceFetch("chunk", { method: "PUT", body: file.slice(state.offset, state.offset + size), signal }, `?${new URLSearchParams({ sourceId: state.id, offset: String(state.offset), size: String(size) })}`);
    state = await response.json(); progress(state);
  }
  while (state.status === "verifying") { signal.throwIfAborted(); state = await sourceRequest("verify", { sourceId: state.id }, signal); progress(state); }
  if (state.status !== "ready") throw new Error("Upload is incomplete. Choose the same file to resume.");
  return state as MeetingSource;
}
