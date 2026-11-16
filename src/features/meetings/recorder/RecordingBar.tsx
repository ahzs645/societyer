/**
 * The floating recording bar: visible on every page while a meeting is being
 * recorded, so the person can keep working elsewhere in the app. However the
 * recording was stopped (here or the Notes tab's Stop), the finished file is
 * saved where the workspace keeps recordings (SharePoint, workspace file
 * storage, or this computer in the desktop app); when the workspace keeps
 * none, the bar offers a download, and closing asks before the audio goes.
 * A recording a crash or closed tab interrupted is offered back here.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { Download, FileAudio, History, Mic, Square, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "@/hooks/useSociety";
import { useConfirm } from "@/components/Modal";
import { triggerBlobDownload } from "../../../lib/zip";
import { meetingSourceBroker, uploadMeetingSource } from "../../../lib/meetingSourceUpload";
import { postToUploadUrl, useMeetingRecordingStore, writeDesktopRecording } from "../recordings/workspaceRecordings";
import {
  adoptRecoveredRecording,
  closeFinishedRecording,
  discardMeetingRecording,
  formatElapsed,
  recordingFileName,
  recordingSaved,
  stopMeetingRecording,
  useMeetingRecorder,
} from "./meetingRecorder";
import { dropStash, listStashes, readStash, STASH_LIVE_MS, type StashMeta } from "./recordingStash";

type SaveState = { status: "idle" } | { status: "saving"; sent: number; total: number } | { status: "saved"; where: string } | { status: "not-kept"; reason: string } | { status: "failed"; error: string };

export function RecordingBar() {
  const recorder = useMeetingRecorder();
  const society = useSociety();
  const confirm = useConfirm();
  const store = useMeetingRecordingStore(society?._id ? String(society._id) : undefined);
  const [leftover, setLeftover] = useState<StashMeta | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const shown = (recorder.phase !== "idle" && recorder.phase !== "starting") || (recorder.phase === "idle" && Boolean(leftover));

  // Floating things at the bottom of a page (the Ask bar) sit above this bar.
  useEffect(() => {
    const node = bar.current;
    const root = document.documentElement;
    if (!shown || !node) return;
    const measure = () => root.style.setProperty("--recording-bar-space", `${Math.ceil(node.getBoundingClientRect().height) + 16}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--recording-bar-space");
    };
  }, [shown]);

  // Leaving or reloading the page would end the recording: ask first.
  useEffect(() => {
    if (recorder.phase !== "recording") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recorder.phase]);

  // A recording a crash or closed tab interrupted (not one still running in another tab).
  useEffect(() => {
    if (recorder.phase !== "idle") return;
    let live = true;
    void listStashes().then((rows) => {
      const stale = rows.filter((row) => Date.now() - row.updatedAt > STASH_LIVE_MS);
      if (live) setLeftover(stale[0] ?? null);
    });
    return () => { live = false; };
  }, [recorder.phase]);

  const { save, setSave, downloaded, setDownloaded, abort, savedFor } = useSaveFinishedRecording(recorder, store, society?._id ? String(society._id) : undefined);

  if (!shown) return null;

  if (recorder.phase === "idle" && leftover) {
    return <RecoverRecordingBar barRef={bar} leftover={leftover} onDone={() => setLeftover(null)} />;
  }

  const id = recorder.meetingId!;
  const transcriptHref = `/app/meetings/${id}?tab=notes&view=transcript`;
  const unkept = Boolean(recorder.file) && save.status !== "saved" && !downloaded;

  const close = async () => {
    if (unkept) {
      const ok = await confirm({
        title: "Close without keeping the recording?",
        message: save.status === "failed"
          ? "It wasn't saved. Download it first if you want to keep it."
          : "It isn't saved anywhere. Download it first if you want to keep it.",
        confirmLabel: "Close and discard",
        tone: "danger",
      });
      if (!ok) return;
    }
    abort.current?.abort();
    savedFor.current = null;
    setSave({ status: "idle" });
    closeFinishedRecording();
  };

  const recording = recorder.phase === "recording";
  return (
    <div ref={bar} className={`recording-bar${recording ? " is-recording" : ""}`} role="region" aria-label="Meeting recording">
      {recording ? (
        <>
          <span className="recording-bar__dot" aria-hidden="true" />
          <span className="recording-bar__label">
            <span className="recording-bar__status">Recording</span>
            <Link to={`/app/meetings/${id}?tab=notes`} className="recording-bar__title">{recorder.meetingTitle}</Link>
          </span>
          <LevelMeter level={recorder.level} />
          <span className="recording-bar__time" aria-live="off">{formatElapsed(recorder.elapsed)}</span>
          {recorder.sharedAudio && <span className="recording-bar__chip" title="Recording your microphone and the shared audio">+ shared audio</span>}
          <button type="button" className="recording-bar__stop" onClick={() => { void stopMeetingRecording().catch(() => undefined); }} aria-label="Stop recording">
            <Square size={12} aria-hidden="true" /> Stop
          </button>
          <button
            type="button"
            className="recording-bar__icon"
            aria-label="Discard recording"
            title="Discard: stop and throw the audio away"
            onClick={() => {
              void confirm({ title: "Discard this recording?", message: "The audio is thrown away.", confirmLabel: "Discard", tone: "danger" })
                .then((ok) => { if (ok) discardMeetingRecording(); });
            }}
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
              {recorder.phase === "finished" && (!store || save.status === "idle") && "Recording ready."}
              {recorder.phase === "finished" && store && save.status === "saving" && `Saving… ${save.total ? Math.floor((100 * save.sent) / save.total) : 0}%`}
              {recorder.phase === "finished" && store && save.status === "saved" && `Saved to ${save.where}.`}
              {recorder.phase === "finished" && store && save.status === "failed" && `Not saved: ${save.error}`}
              {recorder.phase === "finished" && store && save.status === "not-kept" && "Recording ready. This workspace doesn't keep recordings."}
            </span>
            <span className="recording-bar__title">{recorder.recovered ? "Recovered · " : ""}{recorder.meetingTitle} · {formatElapsed(recorder.elapsed)}</span>
          </span>
          {recorder.phase === "finished" && (
            <Link className="recording-bar__action" to={transcriptHref}>
              <Mic size={12} aria-hidden="true" /> Open transcript
            </Link>
          )}
          {recorder.file && (save.status === "not-kept" || save.status === "failed") && (
            <button type="button" className="recording-bar__action" onClick={() => { triggerBlobDownload(recorder.file!, recorder.file!.name); setDownloaded(true); }}>
              <Download size={12} aria-hidden="true" /> Download
            </button>
          )}
          {recorder.phase !== "stopping" && save.status !== "saving" && (
            <button type="button" className="recording-bar__icon" aria-label="Close" onClick={() => { void close(); }}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </>
      )}
      {recorder.notice && recording && <span className="recording-bar__notice" role="status">{recorder.notice}</span>}
    </div>
  );
}

/** Saves every finished recording once, whoever stopped it, where the workspace keeps recordings. */
function useSaveFinishedRecording(recorder: ReturnType<typeof useMeetingRecorder>, store: ReturnType<typeof useMeetingRecordingStore>, societyId: string | undefined) {
  const generateUploadUrl = useMutation(api.meetingRecordings.generateUploadUrl);
  const attach = useMutation(api.meetingRecordings.attach);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [downloaded, setDownloaded] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const savedFor = useRef<File | null>(null);
  const file = recorder.phase === "finished" ? recorder.file : undefined;
  const meetingId = recorder.meetingId;
  useEffect(() => {
    if (!file || !meetingId || savedFor.current === file || !store) return;
    savedFor.current = file;
    setDownloaded(false);
    const where = store.store;
    if (where === "none") {
      setSave({ status: "not-kept", reason: store.detail });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setSave({ status: "saving", sent: 0, total: file.size });
    void (async () => {
      try {
        if (where === "device") {
          const ref = await writeDesktopRecording({ societyId: societyId!, meetingId, file });
          await attach({ meetingId: meetingId as any, fileName: file.name, size: ref.byteLength ?? file.size, mimeType: ref.mimeType, provider: "local-filesystem", storageKey: ref.key, sha256: ref.sha256 });
        } else if (where === "workspace") {
          const url = await generateUploadUrl({ meetingId: meetingId as any, fileName: file.name, size: file.size });
          const storageId = await postToUploadUrl(url, file, (sent, total) => setSave({ status: "saving", sent, total }), controller.signal);
          await attach({ meetingId: meetingId as any, fileName: file.name, storageId: storageId as any });
        } else if (where === "sharepoint" && meetingSourceBroker) {
          await uploadMeetingSource(file, meetingId, (source) => setSave({ status: "saving", sent: source.offset ?? 0, total: file.size }), controller.signal);
        }
        recordingSaved();
        setSave({ status: "saved", where: store.label });
      } catch (error) {
        if (!controller.signal.aborted) setSave({ status: "failed", error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    })();
  }, [file, meetingId, store, societyId, attach, generateUploadUrl]);

  return { save, setSave, downloaded, setDownloaded, abort, savedFor };
}

/** A recording a crash or closed tab interrupted: recover it (it is then saved like any other), or discard it. */
function RecoverRecordingBar({ barRef, leftover, onDone }: { barRef: RefObject<HTMLDivElement>; leftover: StashMeta; onDone: () => void }) {
  const confirm = useConfirm();
  const recover = async () => {
    const recovered = await readStash(leftover, recordingFileName(leftover.meetingTitle, leftover.startedAt, leftover.extension));
    onDone();
    if (!recovered) {
      await dropStash(leftover.id);
      return;
    }
    adoptRecoveredRecording(leftover, recovered);
  };
  const discard = async () => {
    const ok = await confirm({ title: "Discard the unsaved recording?", message: `The audio of ${leftover.meetingTitle} is thrown away.`, confirmLabel: "Discard", tone: "danger" });
    if (!ok) return;
    await dropStash(leftover.id);
    onDone();
  };
  return (
    <div ref={barRef} className="recording-bar" role="region" aria-label="Meeting recording">
      <History size={16} aria-hidden="true" />
      <span className="recording-bar__label">
        <span className="recording-bar__status">A recording wasn't finished. Recover it?</span>
        <span className="recording-bar__title">{leftover.meetingTitle} · {new Date(leftover.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {formatElapsed(leftover.elapsed)}</span>
      </span>
      <button type="button" className="recording-bar__action" onClick={() => { void recover(); }}>Recover</button>
      <button type="button" className="recording-bar__icon" aria-label="Discard the unsaved recording" onClick={() => { void discard(); }}>
        <X size={14} aria-hidden="true" />
      </button>
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
