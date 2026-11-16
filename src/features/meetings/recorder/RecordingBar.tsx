/**
 * The floating recording bar: visible on every page while a meeting is being
 * recorded, so the person can keep working elsewhere in the app. Stop saves
 * the file where the workspace keeps recordings (SharePoint, workspace file
 * storage, or this computer in the desktop app) and offers the transcript;
 * when the workspace keeps none, it offers a download so nothing is lost.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { Download, FileAudio, Mic, Square, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "@/hooks/useSociety";
import { triggerBlobDownload } from "../../../lib/zip";
import { meetingSourceBroker, uploadMeetingSource } from "../../../lib/meetingSourceUpload";
import { postToUploadUrl, useMeetingRecordingStore, writeDesktopRecording } from "../recordings/workspaceRecordings";
import {
  discardMeetingRecording,
  formatElapsed,
  resetRecorder,
  stopMeetingRecording,
  useMeetingRecorder,
} from "./meetingRecorder";

type SaveState = { status: "idle" } | { status: "saving"; sent: number; total: number } | { status: "saved"; where: string } | { status: "not-kept"; reason: string } | { status: "failed"; error: string };

export function RecordingBar() {
  const recorder = useMeetingRecorder();
  const society = useSociety();
  const store = useMeetingRecordingStore(society?._id ? String(society._id) : undefined);
  const generateUploadUrl = useMutation(api.meetingRecordings.generateUploadUrl);
  const attach = useMutation(api.meetingRecordings.attach);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [lastFile, setLastFile] = useState<File | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Leaving or reloading the page would end the recording: ask first.
  useEffect(() => {
    if (recorder.phase !== "recording") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recorder.phase]);

  if (recorder.phase === "idle" || recorder.phase === "starting") return null;
  const meetingId = recorder.meetingId!;
  const transcriptHref = `/app/meetings/${meetingId}?tab=notes&view=transcript`;

  const stop = async () => {
    let file: File;
    try {
      file = await stopMeetingRecording();
    } catch {
      return;
    }
    setLastFile(file);
    const where = store?.store ?? "none";
    if (where === "none") {
      setSave({ status: "not-kept", reason: store?.detail ?? "This workspace doesn't keep recordings." });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setSave({ status: "saving", sent: 0, total: file.size });
    try {
      if (where === "device") {
        const ref = await writeDesktopRecording({ societyId: String(society!._id), meetingId, file });
        await attach({ meetingId: meetingId as any, fileName: file.name, size: ref.byteLength ?? file.size, mimeType: ref.mimeType, provider: "local-filesystem", storageKey: ref.key, sha256: ref.sha256 });
      } else if (where === "workspace") {
        const url = await generateUploadUrl({ meetingId: meetingId as any, fileName: file.name, size: file.size });
        const storageId = await postToUploadUrl(url, file, (sent, total) => setSave({ status: "saving", sent, total }), controller.signal);
        await attach({ meetingId: meetingId as any, fileName: file.name, storageId: storageId as any });
      } else if (where === "sharepoint" && meetingSourceBroker) {
        await uploadMeetingSource(file, meetingId, (source) => setSave({ status: "saving", sent: source.offset ?? 0, total: file.size }), controller.signal);
      }
      setSave({ status: "saved", where: store?.label ?? "the workspace" });
    } catch (error) {
      setSave({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    } finally {
      abort.current = null;
    }
  };

  const close = () => {
    abort.current?.abort();
    setSave({ status: "idle" });
    setLastFile(null);
    resetRecorder();
  };

  const recording = recorder.phase === "recording";
  return (
    <div className={`recording-bar${recording ? " is-recording" : ""}`} role="region" aria-label="Meeting recording">
      {recording ? (
        <>
          <span className="recording-bar__dot" aria-hidden="true" />
          <span className="recording-bar__label">
            <span className="recording-bar__status">Recording</span>
            <Link to={`/app/meetings/${meetingId}?tab=notes`} className="recording-bar__title">{recorder.meetingTitle}</Link>
          </span>
          <LevelMeter level={recorder.level} />
          <span className="recording-bar__time" aria-live="off">{formatElapsed(recorder.elapsed)}</span>
          {recorder.sharedAudio && <span className="recording-bar__chip" title="Recording your microphone and the shared audio">+ shared audio</span>}
          <button type="button" className="recording-bar__stop" onClick={() => { void stop(); }} aria-label="Stop recording">
            <Square size={12} aria-hidden="true" /> Stop
          </button>
          <button
            type="button"
            className="recording-bar__icon"
            aria-label="Discard recording"
            title="Discard: stop and throw the audio away"
            onClick={() => { if (window.confirm("Discard this recording? The audio is thrown away.")) discardMeetingRecording(); }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <FileAudio size={16} aria-hidden="true" />
          <span className="recording-bar__label">
            <span className="recording-bar__status">
              {recorder.phase === "stopping" && "Finishing the recording…"}
              {recorder.phase === "error" && (recorder.error ?? "The recording failed.")}
              {recorder.phase === "finished" && save.status === "saving" && `Saving… ${save.total ? Math.floor((100 * save.sent) / save.total) : 0}%`}
              {recorder.phase === "finished" && save.status === "saved" && `Saved to ${save.where}.`}
              {recorder.phase === "finished" && save.status === "failed" && `Not saved: ${save.error}`}
              {recorder.phase === "finished" && save.status === "not-kept" && "Recording ready. This workspace doesn't keep recordings."}
              {recorder.phase === "finished" && save.status === "idle" && "Recording ready."}
            </span>
            <span className="recording-bar__title">{recorder.meetingTitle} · {formatElapsed(recorder.elapsed)}</span>
          </span>
          {recorder.phase === "finished" && (
            <Link className="recording-bar__action" to={transcriptHref}>
              <Mic size={12} aria-hidden="true" /> Open transcript
            </Link>
          )}
          {lastFile && (save.status === "not-kept" || save.status === "failed") && (
            <button type="button" className="recording-bar__action" onClick={() => triggerBlobDownload(lastFile, lastFile.name)}>
              <Download size={12} aria-hidden="true" /> Download
            </button>
          )}
          {recorder.phase !== "stopping" && save.status !== "saving" && (
            <button type="button" className="recording-bar__icon" aria-label="Close" onClick={close}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </>
      )}
      {recorder.notice && recording && <span className="recording-bar__notice" role="status">{recorder.notice}</span>}
    </div>
  );
}

function LevelMeter({ level }: { level: number }) {
  const bars = [0.15, 0.35, 0.6, 0.85];
  return (
    <span className="recording-bar__meter" aria-hidden="true">
      {bars.map((threshold) => <span key={threshold} className={level >= threshold ? "is-on" : undefined} />)}
    </span>
  );
}
