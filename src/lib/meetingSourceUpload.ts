import { authenticatedFetch } from "./authToken";
import type { MeetingSourceRangeFetch } from "./meetingSourceDownload";
import { uploadMeetingSourceWith, type MeetingSource, type MeetingSourceTransport } from "./meetingSourceTransfer";

export { sourceFingerprint, type MeetingSource } from "./meetingSourceTransfer";

export const meetingSourceBroker = String(import.meta.env.VITE_MEETING_SOURCE_BROKER_URL ?? "").replace(/\/$/, "");

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

const brokerTransport: MeetingSourceTransport = {
  request: (operation, data, signal) => sourceRequest(operation, data, signal),
  putChunk: async (sourceId, offset, body, signal) => {
    const query = `?${new URLSearchParams({ sourceId, offset: String(offset), size: String(body.size) })}`;
    return (await sourceFetch("chunk", { method: "PUT", body, signal }, query)).json();
  },
};

/** Upload (or resume) through the configured broker; see meetingSourceTransfer. */
export function uploadMeetingSource(file: File, meetingId: string, progress: (source: MeetingSource) => void, signal: AbortSignal) {
  return uploadMeetingSourceWith(brokerTransport, file, meetingId, progress, signal);
}
