/**
 * Meeting recordings kept in workspace file storage (convex/meetingRecordings.ts):
 * which store this workspace uses here, and moving recording bytes in and out.
 *
 *   hosted:  upload URL -> POST the file (with progress) -> meetingRecordings:attach(storageId)
 *   desktop: bridge.writeDocumentVersion -> meetingRecordings:attach(provider "local-filesystem")
 *
 * SharePoint recordings use the Meeting source files pipeline instead.
 */
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { getDocumentStorageProvider } from "../../../lib/runtimeMode";
import { getDesktopBridge, isDesktopBridgeAvailable } from "../../../lib/desktopBridge";
import { meetingSourceBroker } from "../../../lib/meetingSourceUpload";
import { meetingRecordingMimeType } from "../../../lib/meetingSourceDownload";
import {
  meetingRecordingStore,
  type MeetingRecordingPreference,
  type MeetingRecordingRuntime,
  type MeetingRecordingStoreResult,
} from "../../../../shared/meetingRecordingStorage";

export type WorkspaceRecording = {
  id: string;
  fileName: string;
  size: number;
  mimeType?: string;
  provider: "convex" | "local-filesystem";
  storageKey: string;
  createdAtISO: string;
  url: string | null;
};

export type MeetingRecordingSettings = {
  preference: MeetingRecordingPreference;
  policy: { nativeUploads: boolean; documentVersionProvider: "native" | "sharepoint" } | null;
  serverTranscription: { maxBytes: number } | null;
};

export function meetingRecordingRuntime(): MeetingRecordingRuntime {
  if (!isLocalDataRuntime()) return "hosted";
  return isDesktopBridgeAvailable() && getDocumentStorageProvider() === "local-filesystem" ? "desktop" : "browser-local";
}

/** This workspace's recording settings and where recordings go on this runtime (undefined while loading). */
export function useMeetingRecordingStore(societyId: string | undefined): (MeetingRecordingStoreResult & { settings: MeetingRecordingSettings }) | undefined {
  const settings = useQuery(api.meetingRecordings.settings, societyId ? { societyId: societyId as any } : "skip") as MeetingRecordingSettings | undefined;
  if (!settings) return undefined;
  return {
    ...meetingRecordingStore({
      runtime: meetingRecordingRuntime(),
      preference: settings.preference,
      policy: settings.policy,
      sharePointBroker: Boolean(meetingSourceBroker),
    }),
    settings,
  };
}

export type UploadProgress = (sent: number, total: number) => void;

/** POSTs a file to a Convex upload URL with progress; returns the `_storage` id. */
export function postToUploadUrl(url: string, file: File, onProgress: UploadProgress, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Content-Type", file.type || meetingRecordingMimeType(file.name));
    request.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : file.size);
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) return reject(new Error(`The upload failed (${request.status}).`));
      try {
        const { storageId } = JSON.parse(request.responseText) as { storageId?: string };
        if (!storageId) throw new Error("missing storageId");
        resolve(storageId);
      } catch {
        reject(new Error("The upload finished but the server's reply was unreadable."));
      }
    };
    request.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    request.onabort = () => reject(new DOMException("Upload cancelled.", "AbortError"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

/** Desktop: writes the recording into the workspace's files on this computer. */
export async function writeDesktopRecording(args: { societyId: string; meetingId: string; file: File }) {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("Saving recordings on this computer needs the desktop app.");
  return bridge.writeDocumentVersion({
    societyId: args.societyId,
    // Recordings sit beside document versions, grouped per meeting.
    documentId: `meeting-recording-${args.meetingId}`,
    fileName: args.file.name,
    mimeType: args.file.type || meetingRecordingMimeType(args.file.name),
    bytes: await args.file.arrayBuffer(),
  });
}

/** Reads a kept recording into a File for playback, with download progress when the size is known. */
export async function fetchWorkspaceRecording(recording: WorkspaceRecording, onProgress: UploadProgress, signal?: AbortSignal): Promise<File> {
  const type = recording.mimeType || meetingRecordingMimeType(recording.fileName);
  if (recording.provider === "local-filesystem") {
    const bridge = getDesktopBridge();
    if (!bridge) throw new Error("This recording is saved on a computer running the desktop app.");
    const bytes = await bridge.readDocumentVersion({ key: recording.storageKey });
    onProgress(bytes.byteLength, bytes.byteLength);
    return new File([bytes], recording.fileName, { type });
  }
  if (!recording.url) throw new Error("This recording is no longer in storage.");
  const response = await fetch(recording.url, { signal });
  if (!response.ok || !response.body) throw new Error(`The recording could not be downloaded (${response.status}).`);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    onProgress(received, recording.size);
  }
  return new File(parts as BlobPart[], recording.fileName, { type });
}
