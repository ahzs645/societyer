/**
 * "Recordings and transcripts": the one place to bring a meeting's recording
 * or transcript in on a connected deployment (private Microsoft storage
 * through the transfer broker). Add a file, then on the same row play it,
 * transcribe it (the connected WhisperX processor, or the speech provider),
 * follow the transcription, review it and use it as the meeting transcript.
 * Shown in the Transcript view (where Play loads the recording into the
 * player) and on the Sources tab.
 */
import { FilePreviewDialog, MAX_FILE_PREVIEW_BYTES } from "../../../components/FilePreviewDialog";
import { downloadMeetingSourceBlob, meetingRecordingMimeType } from "../../../lib/meetingSourceDownload";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { Download, Eye, FileAudio, FileText, Play, Plus, Settings, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { meetingSourceBroker, meetingSourceRangeFetcher, sourceRequest, uploadMeetingSource, type MeetingSource } from "@/lib/meetingSourceUpload";
import { downloadMeetingSourceRanges } from "@/lib/meetingSourceDownload";
import { importMeetingSourceText } from "@/lib/meetingTranscriptImport";
import { isLocalDataRuntime } from "@/lib/staticRuntime";
import { MEETING_TRANSCRIPT_MAX_BYTES } from "../../../../shared/storage/meetingSourceProtocol";
import { api as typedApi } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useFileDrop } from "../../../components/FileDropZone";
import { useConfirm } from "../../../components/Modal";
import { usePermissions } from "../../../hooks/usePermissions";
import { usePermissionedMutation } from "../../../hooks/usePermissionedMutation";
import { REPLACE_TRANSCRIPT_CONFIRM, REVIEW_SPEAKERS_INTENT, timedTranscriptOffer } from "../transcript/timedImportOffer";
import { needsSpeakerReview } from "../transcript/speakerSuggestions";
import type { TimedTranscript } from "../transcript/timedTranscript";
import { CandidatePreview, ProcessorSettings, type Connection } from "../transcript/WhisperXDialogs";
import { formatRecordingSize, type AttachedRecordings } from "../transcript/AttachedRecordingsPanel";
import { MEETING_SOURCE_ACCEPT, TRANSCRIPT_SOURCE_FILE } from "../../../../shared/transcriptFormats";
import { latestJobBySource, meetingFileRow, type FileAction, type FileJob, type FileRow } from "./meetingFileRows";

type TimedOffer = TimedTranscript & { fileName: string; sourceName: string };

const PIPELINE_DOC_URL = "https://github.com/ahzs645/societyer/blob/main/docs/meeting-source-pipeline.md";

/** Chrome's File System Access save dialog; other browsers download through a Blob URL. */
type SaveFilePicker = (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<FileSystemWritableFileStream> }>;

type MeetingSourcesAccess = {
  societyId: string;
  meetingId: string;
  /** minutes:write: transcribing and using a transcript. */
  canDraft: boolean;
  /** Decision A1: reading a working transcript needs meetings:read and minutes:write. */
  canReadTranscript: boolean;
  /**
   * In the Transcript view: plays a recording right there, and a recording
   * added from this device loads into the player without downloading it again.
   */
  player?: {
    attached: Pick<AttachedRecordings<MeetingSource>, "play" | "download" | "cancel" | "error">;
    openLocal: (file: File) => void;
  };
  /** The current working transcript, so "Use transcript" can say it replaces it. */
  transcript?: { _id?: string; createdAtISO?: string; contentRevision?: string } | null;
};

/** For meeting editors (meetings:write) on broker-configured hosted deployments. */
export function MeetingSourcesCard({ canWrite, ...access }: MeetingSourcesAccess & { canWrite: boolean }) {
  if (!meetingSourceBroker || isLocalDataRuntime() || !canWrite) return null;
  return <ConnectedMeetingSources key={access.meetingId} {...access} />;
}

function ConnectedMeetingSources({ societyId, meetingId, canDraft, canReadTranscript, player, transcript }: MeetingSourcesAccess) {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [, setSearchParams] = useSearchParams();
  const [sources, setSources] = useState<MeetingSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState<MeetingSource | null>(null);
  const [filePreview, setFilePreview] = useState<MeetingSource | null>(null);
  const [textPreview, setTextPreview] = useState<MeetingSource | null>(null);
  const [page, setPage] = useState(0);
  const [reviewJob, setReviewJob] = useState<FileJob | null>(null);
  const [configure, setConfigure] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const appendText = useMutation(api.meetingSources.appendText);
  const selectTranscript = useMutation(api.meetingSources.useTranscript);
  const transcribe = useAction(api.meetingSourceSpeech.start);
  const enqueue = useMutation(api.meetingTranscription.enqueue);
  const cancelJob = useMutation(api.meetingTranscription.cancel);
  const applyJob = useMutation(api.meetingTranscription.apply);
  const connection = useQuery(api.meetingTranscription.settings, { societyId }) as Connection | null | undefined;
  const jobs = useQuery(api.meetingTranscription.jobs, { meetingId }) as Array<FileJob & { pageCount: number }> | undefined;
  const speech = useQuery(api.meetingSources.speechCapabilities, { meetingId }) as { configured: boolean } | undefined;
  // Timed files (.vtt/.srt/.json, or the one inside a ZIP) can become the timed working transcript.
  const [timedOffer, setTimedOffer] = useState<TimedOffer | null>(null);
  const importTimed = usePermissionedMutation(typedApi.transcripts.importTimed, true);
  const textPage = useQuery(api.meetingSources.textPage, textPreview && canReadTranscript ? { sourceId: textPreview.id, index: page } : "skip") as { text: string } | null | undefined;
  const whisperX = Boolean(connection?.enabled);
  const online = Boolean(connection?.heartbeatAt && Date.now() - connection.heartbeatAt < 120_000);
  const jobBySource = useMemo(() => latestJobBySource(jobs), [jobs]);
  const caps = { whisperX, speech: Boolean(speech?.configured), canDraft, canReadTranscript };

  const loadPreview = useCallback(async (signal: AbortSignal) => {
    if (!filePreview || filePreview.size > MAX_FILE_PREVIEW_BYTES) throw new Error("Choose Download for files above 25 MB.");
    const blob = await downloadMeetingSourceBlob(filePreview.size, meetingRecordingMimeType(filePreview.fileName), { fetchRange: meetingSourceRangeFetcher(filePreview.id), signal });
    signal.throwIfAborted();
    return blob.arrayBuffer();
  }, [filePreview]);
  const refresh = useCallback(async () => { setSources(await sourceRequest("list", { meetingId })); }, [meetingId]);
  useEffect(() => {
    let mounted = true;
    sourceRequest("list", { meetingId }).then(rows => { if (mounted) setSources(rows); }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; controller.current?.abort(); };
  }, [meetingId]);
  const hasSpeechJob = sources.some(source => source.jobStatus === "processing");
  useEffect(() => { if (!hasSpeechJob) return; const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 10_000); return () => window.clearInterval(timer); }, [hasSpeechJob, refresh]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : `${label} failed.`); }
  };

  async function upload(file: File) {
    setBusy(true); setActive(null); setError(""); setTimedOffer(null); setMessage("Checking the file so uploads can resume safely…");
    const abort = new AbortController(); controller.current = abort;
    // Parsed while the browser still has the File; offered once the original is attached.
    const timed = timedTranscriptOffer(file).catch(() => null);
    const isText = TRANSCRIPT_SOURCE_FILE.test(file.name) || /\.zip$/i.test(file.name);
    // A recording added here plays at once from this device while it uploads.
    if (!isText && player && canReadTranscript) player.openLocal(file);
    try {
      const source = await uploadMeetingSource(file, meetingId, state => { setActive(state); setMessage(state.status === "verifying" ? "Verifying the stored file…" : "Uploading to private meeting storage…"); }, abort.signal);
      if (isText) {
        setMessage("Saved. Importing the transcript text…");
        await importMeetingSourceText(file, chunk => appendText({ sourceId: source.id, ...chunk }), abort.signal);
        const parsed = await timed;
        if (parsed && canReadTranscript) {
          setTimedOffer({ ...parsed, sourceName: file.name });
          setMessage("Saved. It has timings: open it as the meeting transcript below.");
        } else setMessage(canDraft ? "Saved and its text imported. Choose Use for minutes on its row to make it the meeting transcript." : "Saved and its text imported.");
      } else {
        setMessage(whisperX || speech?.configured
          ? "Recording saved. Choose Transcribe on its row to turn it into a transcript."
          : "Recording saved. Automatic transcription isn't set up, so add a VTT, SRT or Whisper export of it to get a transcript.");
      }
    } catch (e) {
      if (abort.signal.aborted) setMessage("Paused. Choose the same file to resume. If a chunk was in flight, wait 90 seconds first.");
      else setError(e instanceof Error ? e.message : "Upload failed.");
    } finally { setBusy(false); controller.current = null; await refresh().catch(() => undefined); }
  }

  // Choose or drop a file onto the card. Size and name checks stay with
  // uploadMeetingSource (500 MB, decimal) so its messages are unchanged.
  const drop = useFileDrop({
    accept: MEETING_SOURCE_ACCEPT,
    disabled: busy,
    onFiles: ([file]) => { if (file) void upload(file); },
    onReject: () => setError("Choose TXT, VTT, SRT, SBV, Whisper JSON/ZIP, or an audio/video recording."),
  });
  const { onDragEnter, onDragOver, onDragLeave, onDrop } = drop.rootProps;

  /** Outside the Transcript view: go there (with an intent the Transcript view understands). */
  function goToTranscript(intent?: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("tab", "transcript");
      if (intent) next.set("intent", intent); else next.delete("intent");
      return next;
    });
  }

  async function openTimed(offer: TimedOffer) {
    if (transcript && !(await confirm(REPLACE_TRANSCRIPT_CONFIRM))) return;
    await run("Opening the transcript", async () => {
      const { provider, segments, durationSeconds } = offer;
      await importTimed({ societyId: societyId as Id<"societies">, meetingId: meetingId as Id<"meetings">, provider, segments, durationSeconds });
      setTimedOffer(null);
      setMessage("It's now the meeting transcript.");
      const review = needsSpeakerReview(segments) ? REVIEW_SPEAKERS_INTENT : undefined;
      if (!player) goToTranscript(review);
      else if (review) setSearchParams(prev => { const next = new URLSearchParams(prev); next.set("intent", review); return next; });
    });
  }

  async function download(source: MeetingSource) {
    setError("");
    try {
      // Chrome can stream directly to disk; other browsers use their Blob download path.
      const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
      const handle = picker ? await picker({ suggestedName: source.fileName }) : null;
      const writable = handle ? await handle.createWritable() : null; const parts: Blob[] = [];
      try {
        await downloadMeetingSourceRanges(source.size, { fetchRange: meetingSourceRangeFetcher(source.id), onPart: async part => { if (writable) await writable.write(part); else parts.push(part); } });
        if (writable) await writable.close();
        else { const url = URL.createObjectURL(new Blob(parts)); const anchor = document.createElement("a"); anchor.href = url; anchor.download = source.fileName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      } catch (e) { await writable?.abort().catch(() => undefined); throw e; }
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Download failed."); }
  }

  async function act(action: FileAction, source: MeetingSource, job: FileJob | undefined) {
    switch (action) {
      case "play":
        if (player) await run("Playing the recording", () => player.attached.play(source));
        else goToTranscript();
        return;
      case "transcribe":
        if (whisperX) return run("Queueing the recording", () => enqueue({ sourceId: source.id }));
        if (!(await confirm({ title: "Transcribe recording?", message: "Transcribe this recording using the configured speech provider? Its usage charges apply.", confirmLabel: "Start transcription", tone: "warn" }))) return;
        return run("Transcription", async () => { await transcribe({ sourceId: source.id }); await refresh(); setMessage("Transcription started. You can leave this meeting while it runs."); });
      case "retryTranscription":
        return run("Queueing the recording", () => enqueue({ sourceId: source.id }));
      case "cancelTranscription":
        return job && run("Cancelling", () => cancelJob({ jobId: job.id as any }));
      case "reviewTranscription":
        if (job) setReviewJob(job);
        return;
      case "useTranscription":
        if (!job) return;
        if (!(await confirm({ title: "Use this transcript?", message: transcript ? "Replace the current meeting transcript with this one? Draft and approved minutes are kept." : "Use this as the meeting transcript?", confirmLabel: "Use transcript" }))) return;
        return run("Using the transcript", async () => {
          await applyJob({ jobId: job.id as any, replace: Boolean(transcript), expectedRevision: transcript ? transcript.contentRevision ?? `${transcript._id}:${transcript.createdAtISO}` : undefined });
          setMessage("It's now the meeting transcript.");
          if (!player) goToTranscript();
        });
      case "readText":
        setTextPreview(source); setPage(0);
        return;
      case "useText":
        if (!(await confirm({ title: "Use this transcript for the meeting?", message: "This replaces the current working transcript. Existing minutes text stays as it is.", confirmLabel: "Use transcript", tone: "warn" }))) return;
        return run("Using the transcript", async () => { await selectTranscript({ sourceId: source.id }); setMessage("It's now the meeting transcript."); await refresh(); });
      case "preview":
        setFilePreview(source);
        return;
      case "download":
        return download(source);
      case "cancelUpload":
        return run("Cancelling the upload", async () => { await sourceRequest("cancel", { sourceId: source.id }); await refresh(); });
    }
  }

  const processorNote = connection === undefined ? null
    : whisperX ? (online ? "WhisperX processor connected: recordings are transcribed one at a time." : "Waiting for the WhisperX processor: queued recordings wait safely until it connects.")
    : speech?.configured ? null
    : "Automatic transcription isn't set up. Add a VTT, SRT or Whisper export of the recording instead, for example from Teams, Zoom or a Whisper app.";

  return <section className={`card meeting-files file-drop-target is-${drop.dragState}`} aria-label="Recordings and transcripts" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {filePreview && <FilePreviewDialog file={{ id: filePreview.id, name: filePreview.fileName, bytes: filePreview.size }} loadBytes={loadPreview} onClose={() => setFilePreview(null)} onDownload={() => void download(filePreview)} />}
    {reviewJob && <CandidatePreview job={{ id: reviewJob.id, pageCount: (reviewJob as FileJob & { pageCount?: number }).pageCount ?? 1 }} close={() => setReviewJob(null)} />}
    {configure && <ProcessorSettings societyId={societyId} connection={connection ?? null} close={() => setConfigure(false)} />}
    <div className="card__head meeting-files__head">
      <h3 className="card__title"><FileAudio size={14} aria-hidden="true" /> Recordings and transcripts</h3>
      <div className="meeting-files__head-actions">
        {can("settings:write") && <button className="btn-action" type="button" onClick={() => setConfigure(true)}><Settings size={12} aria-hidden="true" /> Processor</button>}
        <input {...drop.inputProps} />
        <button className="btn-action btn-action--primary" type="button" disabled={busy} onClick={drop.open}><Plus size={12} aria-hidden="true" /> Add file</button>
      </div>
    </div>
    <div className="card__body meeting-files__body">
      <p className="muted meeting-files__intro">
        Drop a recording or a transcript file (VTT, SRT, SBV, Whisper JSON or ZIP, TXT) here, up to 500 MB. Files stay in private Microsoft storage; only meeting editors see them.
        {processorNote && <> {processorNote}</>}
        {processorNote && !whisperX && !speech?.configured && <> <a className="text-link" href={PIPELINE_DOC_URL} target="_blank" rel="noreferrer">How meeting files become minutes</a></>}
      </p>
      {busy && <div className="meeting-files__progress">
        {active && <><progress aria-label={active.status === "verifying" ? "Verifying stored file" : "Uploading file"} max={active.size} value={active.status === "verifying" ? active.verifiedOffset : active.offset} /> {Math.round(100 * (active.status === "verifying" ? active.verifiedOffset : active.offset) / active.size)}%</>}
        <button className="btn-action" type="button" onClick={() => controller.current?.abort()}>Pause</button>
      </div>}
      {message && <p role="status" className="meeting-files__message">{message}</p>}
      {timedOffer && <p className="meeting-files__offer">
        {timedOffer.sourceName} has timings{timedOffer.segments.some(segment => segment.speaker !== "Speaker") ? " and speakers" : ""} ({timedOffer.segments.length.toLocaleString()} segments).{" "}
        <button className="btn-action btn-action--primary" type="button" disabled={busy} onClick={() => void openTimed(timedOffer)}>Use as the meeting transcript</button>
      </p>}
      {(error || player?.attached.error) && <p role="alert" className="meeting-files__error">{error || player?.attached.error}</p>}
      {sources.length > 0 && <ul className="meeting-files__list">{sources.map(source => {
        const job = jobBySource.get(source.id);
        return <MeetingFileItem
          key={source.id}
          source={source}
          job={job}
          row={meetingFileRow(source, job, caps, MEETING_TRANSCRIPT_MAX_BYTES)}
          player={player}
          busy={busy}
          onAction={(action) => void act(action, source, job)}
        />;
      })}</ul>}
      {canReadTranscript && textPreview && <div className="meeting-files__text"><h4>{textPreview.fileName}</h4><p className="muted">Page {page + 1} of {textPreview.textChunks}</p>
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: "24rem", overflow: "auto" }}>{textPage?.text ?? "Loading…"}</pre>
        <button className="btn-action" type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>{" "}
        <button className="btn-action" type="button" disabled={page + 1 >= (textPreview.textChunks ?? 0)} onClick={() => setPage(p => p + 1)}>Next</button>{" "}
        <button className="btn-action" type="button" onClick={() => setTextPreview(null)}>Close</button>
      </div>}
    </div>
  </section>;
}

const ACTION_LABELS: Record<FileAction, string> = {
  play: "Play",
  transcribe: "Transcribe",
  retryTranscription: "Retry",
  cancelTranscription: "Cancel",
  reviewTranscription: "Review",
  useTranscription: "Use transcript",
  readText: "Read",
  useText: "Use for minutes",
  preview: "Preview",
  download: "Download",
  cancelUpload: "Cancel upload",
};
const PRIMARY_ACTIONS = new Set<FileAction>(["transcribe", "useTranscription", "retryTranscription"]);
const ACTION_ICONS: Partial<Record<FileAction, ReactNode>> = {
  play: <Play size={12} aria-hidden="true" />,
  readText: <FileText size={12} aria-hidden="true" />,
  preview: <Eye size={12} aria-hidden="true" />,
  download: <Download size={12} aria-hidden="true" />,
};

/** One file: its size and state (upload, transcription) and what can be done with it. */
function MeetingFileItem({ source, job, row, player, busy, onAction }: {
  source: MeetingSource;
  job: FileJob | undefined;
  row: FileRow;
  player: MeetingSourcesAccess["player"];
  busy: boolean;
  onAction: (action: FileAction) => void;
}) {
  const downloading = player?.attached.download?.id === source.id ? player.attached.download : null;
  const label = (action: FileAction) =>
    action === "play" && !player ? "Play in Transcript"
      : action === "cancelTranscription" && job?.status === "ready" ? "Discard"
      : ACTION_LABELS[action];
  return <li className="meeting-files__item">
    <div className="meeting-files__meta">
      <strong className="meeting-files__name">{source.fileName}</strong>
      <span className={`meeting-files__status is-${row.tone}`}>{formatRecordingSize(source.size)} · {row.status}</span>
      {job?.status === "running" && job.progress !== null && <progress max={1} value={job.progress} aria-label={`Transcribing ${source.fileName}`} />}
      {downloading && <span className="muted">
        Loading for playback… {Math.floor((100 * downloading.received) / downloading.total)}%{" "}
        <button type="button" className="btn-action btn-action--icon" aria-label="Stop loading" onClick={player!.attached.cancel}><X size={12} aria-hidden="true" /></button>
      </span>}
    </div>
    <div className="meeting-files__actions">
      {row.actions.map(action => (
        <button
          key={action}
          type="button"
          className={`btn-action${PRIMARY_ACTIONS.has(action) ? " btn-action--primary" : ""}`}
          disabled={busy || (action === "play" && Boolean(player?.attached.download))}
          aria-label={`${label(action)}: ${source.fileName}`}
          onClick={() => onAction(action)}
        >
          {ACTION_ICONS[action]} {label(action)}
        </button>
      ))}
    </div>
  </li>;
}
