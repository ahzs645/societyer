import { useCallback, useEffect, useRef, useState } from "react";
import {
  meetingSourceRangeFetcher,
  sourceRequest,
  type MeetingSource,
} from "../../../lib/meetingSourceUpload";
import { downloadMeetingSourceBlob, meetingRecordingMimeType } from "../../../lib/meetingSourceDownload";

export type AttachedRecordingDownload = { id: string; fileName: string; received: number; total: number };

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Recordings attached through Meeting source files live in SharePoint. Playing
 * one downloads it through the broker's verified 5 MiB ranges into memory and
 * hands a File to the same object-URL path as a recording opened from the device.
 */
export function useAttachedSharePointRecording(meetingId: string, onLoaded: (file: File) => void) {
  const [recordings, setRecordings] = useState<MeetingSource[] | null>(null);
  const [listing, setListing] = useState(false);
  const [download, setDownload] = useState<AttachedRecordingDownload | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const listController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      listController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    setRecordings(null);
    setDownload(null);
    setMessage("");
    setError("");
  }, [meetingId]);

  const refresh = useCallback(async () => {
    listController.current?.abort();
    const abort = new AbortController();
    listController.current = abort;
    setListing(true);
    setError("");
    try {
      const rows = (await sourceRequest("list", { meetingId }, abort.signal)) as MeetingSource[];
      if (!abort.signal.aborted) {
        setRecordings(rows.filter((source) => source.kind === "recording" && source.status === "ready"));
      }
    } catch (caught) {
      if (!abort.signal.aborted && !isAbort(caught)) {
        setError(caught instanceof Error ? caught.message : "Attached recordings could not be listed.");
      }
    } finally {
      if (listController.current === abort) {
        listController.current = null;
        setListing(false);
      }
    }
  }, [meetingId]);

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  const play = useCallback(
    async (source: MeetingSource) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setError("");
      setMessage("");
      setDownload({ id: source.id, fileName: source.fileName, received: 0, total: source.size });
      try {
        const type = meetingRecordingMimeType(source.fileName);
        const blob = await downloadMeetingSourceBlob(source.size, type, {
          fetchRange: meetingSourceRangeFetcher(source.id),
          signal: abort.signal,
          onProgress: (received, total) =>
            setDownload({ id: source.id, fileName: source.fileName, received, total }),
        });
        abort.signal.throwIfAborted();
        onLoaded(new File([blob], source.fileName, { type }));
        setMessage(`${source.fileName} is ready to play.`);
      } catch (caught) {
        // A newer choice replaced this download; its own state is already showing.
        if (controller.current !== abort) return;
        if (abort.signal.aborted || isAbort(caught)) setMessage("Download cancelled.");
        else setError(caught instanceof Error ? caught.message : "The recording could not be downloaded.");
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setDownload(null);
        }
      }
    },
    [onLoaded],
  );

  return { recordings, listing, download, message, error, refresh, play, cancel };
}

export type AttachedSharePointRecording = ReturnType<typeof useAttachedSharePointRecording>;
