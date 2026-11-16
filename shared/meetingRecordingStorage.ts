/**
 * Where a workspace keeps meeting recordings. Pure module.
 *
 * Two inputs decide it:
 *  - the workspace's choice (`societies.meetingRecordingPreference`), set by
 *    an administrator in Settings: keep recordings, or keep transcripts only;
 *  - where this workspace can store large files at all: the operator's
 *    storage policy on a connected deployment (SharePoint or native file
 *    storage), the desktop app's own disk, or nothing in a browser-only
 *    workspace.
 *
 * Whatever the answer, a recording can always be opened from the device in
 * the Transcript tab and transcribed there; this only decides what is kept.
 */

export const MEETING_RECORDING_PREFERENCES = ["keep", "transcripts_only"] as const;
export type MeetingRecordingPreference = (typeof MEETING_RECORDING_PREFERENCES)[number];

export function isMeetingRecordingPreference(value: unknown): value is MeetingRecordingPreference {
  return (MEETING_RECORDING_PREFERENCES as readonly unknown[]).includes(value);
}

/** Absent = keep: recordings were always kept where storage allowed. */
export function meetingRecordingPreference(society: { meetingRecordingPreference?: unknown } | null | undefined): MeetingRecordingPreference {
  return isMeetingRecordingPreference(society?.meetingRecordingPreference) ? society!.meetingRecordingPreference as MeetingRecordingPreference : "keep";
}

/**
 * sharepoint: the private SharePoint library, through the transfer broker
 *             (Meeting source files: resumable, 500 MB, server transcription).
 * workspace:  the deployment's file storage, beside the workspace's documents.
 * device:     this computer's disk, in the desktop app.
 * none:       not kept.
 */
export type MeetingRecordingStore = "sharepoint" | "workspace" | "device" | "none";

export type MeetingRecordingRuntime = "hosted" | "desktop" | "browser-local";

export type MeetingRecordingStoreInput = {
  runtime: MeetingRecordingRuntime;
  preference: MeetingRecordingPreference;
  /** Hosted only: the operator's storage policy for the workspace. */
  policy?: { nativeUploads: boolean; documentVersionProvider: "native" | "sharepoint" } | null;
  /** Hosted only: the SharePoint transfer broker is configured in this build. */
  sharePointBroker?: boolean;
};

export type MeetingRecordingStoreResult = { store: MeetingRecordingStore; label: string; detail: string };

export const MEETING_RECORDING_MAX_BYTES = 500_000_000;

export function meetingRecordingStore(input: MeetingRecordingStoreInput): MeetingRecordingStoreResult {
  if (input.preference === "transcripts_only") {
    return {
      store: "none",
      label: "Transcripts only",
      detail: "This workspace keeps transcripts and notes, not recordings. Open a recording from your device to play or transcribe it; it isn't saved.",
    };
  }
  if (input.runtime === "desktop") {
    return { store: "device", label: "This computer", detail: "Recordings are saved with this workspace's files on this computer. Workspace backups don't include them; keep your own copy of recordings you need." };
  }
  if (input.runtime === "browser-local") {
    return {
      store: "none",
      label: "Not kept in the browser",
      detail: "A browser-only workspace can't hold large recordings. Open a recording from your device to play or transcribe it, or use the desktop app to keep recordings.",
    };
  }
  if (input.policy?.documentVersionProvider === "sharepoint") {
    return input.sharePointBroker
      ? { store: "sharepoint", label: "SharePoint", detail: "Recordings go to the workspace's private SharePoint library under Meeting source files." }
      : { store: "none", label: "SharePoint (not connected)", detail: "This workspace stores files in SharePoint, but the transfer service isn't configured on this deployment, so recordings aren't kept." };
  }
  if (input.policy?.nativeUploads) {
    return { store: "workspace", label: "Workspace file storage", detail: "Recordings are kept in this workspace's private file storage. Only people who can edit meetings can play or download them." };
  }
  return {
    store: "none",
    label: "File storage is off",
    detail: "File uploads are turned off for this workspace, so recordings aren't kept. Open a recording from your device to play or transcribe it.",
  };
}

/** Recording files only: transcripts and archives go through their own imports. */
export const MEETING_RECORDING_ACCEPT = "audio/*,video/*,.mp3,.mp4,.m4a,.wav,.webm,.ogg,.oga,.flac,.aac,.mov,.mkv,.wma";
