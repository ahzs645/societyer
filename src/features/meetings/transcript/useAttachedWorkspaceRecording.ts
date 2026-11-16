import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { AttachedRecordingDownload } from "./useAttachedSharePointRecording";
import { fetchWorkspaceRecording, type WorkspaceRecording } from "../recordings/workspaceRecordings";

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Recordings kept in workspace file storage (hosted native storage or the
 * desktop app's disk), for the Transcript tab's Attached recordings panel.
 * The same shape as useAttachedSharePointRecording: playing one reads it into
 * a File and hands it to the same path as a recording opened from the device.
 */
export function useAttachedWorkspaceRecording(meetingId: string, enabled: boolean, onLoaded: (file: File) => void) {
  // Listing waits until the panel is opened, like the SharePoint list.
  const [requested, setRequested] = useState(false);
  const rows = useQuery(api.meetingRecordings.list, enabled && requested ? { meetingId: meetingId as any } : "skip") as WorkspaceRecording[] | undefined;
  const [download, setDownload] = useState<AttachedRecordingDownload | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    setRequested(false);
    setDownload(null);
    setMessage("");
    setError("");
  }, [meetingId]);

  const refresh = useCallback(async () => {
    setRequested(true);
  }, []);
  const cancel = useCallback(() => controller.current?.abort(), []);

  const play = useCallback(
    async (recording: WorkspaceRecording) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setError("");
      setMessage("");
      setDownload({ id: recording.id, fileName: recording.fileName, received: 0, total: recording.size });
      try {
        const file = await fetchWorkspaceRecording(
          recording,
          (received, total) => setDownload({ id: recording.id, fileName: recording.fileName, received, total }),
          abort.signal,
        );
        abort.signal.throwIfAborted();
        onLoaded(file);
        setMessage(`${recording.fileName} is ready to play.`);
      } catch (caught) {
        if (controller.current !== abort) return;
        if (abort.signal.aborted || isAbort(caught)) setMessage("Download cancelled.");
        else setError(caught instanceof Error ? caught.message : "The recording could not be opened.");
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setDownload(null);
        }
      }
    },
    [onLoaded],
  );

  return {
    recordings: requested ? rows ?? null : null,
    listing: requested && rows === undefined,
    download,
    message,
    error,
    refresh,
    play,
    cancel,
  };
}
