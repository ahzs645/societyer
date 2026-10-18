import { FilePreviewDialog, MAX_FILE_PREVIEW_BYTES } from "../../../components/FilePreviewDialog";
import { downloadMeetingSourceBlob, meetingRecordingMimeType } from "../../../lib/meetingSourceDownload";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { meetingSourceBroker, meetingSourceRangeFetcher, sourceRequest, uploadMeetingSource, type MeetingSource } from "@/lib/meetingSourceUpload";
import { downloadMeetingSourceRanges } from "@/lib/meetingSourceDownload";
import { meetingTranscriptChunks } from "@/lib/meetingTranscriptImport";
import { isLocalDataRuntime } from "@/lib/staticRuntime";
import { MEETING_TRANSCRIPT_MAX_BYTES } from "../../../../shared/storage/meetingSourceProtocol";
import { api as typedApi } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useFileDrop } from "../../../components/FileDropZone";
import { useConfirm } from "../../../components/Modal";
import { usePermissionedMutation } from "../../../hooks/usePermissionedMutation";
import { REPLACE_TRANSCRIPT_CONFIRM, REVIEW_SPEAKERS_INTENT, timedTranscriptOffer } from "../transcript/timedImportOffer";
import { needsSpeakerReview } from "../transcript/speakerSuggestions";
import type { TimedTranscript } from "../transcript/timedTranscript";

type TimedOffer = TimedTranscript & { fileName: string; sourceName: string };

const SOURCE_ACCEPT = ".txt,.vtt,.srt,.json,.zip,.mp3,.mp4,.m4a,.wav,.webm,.ogg,.oga,.flac,.aac,.mov,.mkv,.wma";

export function MeetingSourcesCard({ societyId, meetingId, canWrite, canDraft }: { societyId: string; meetingId: string; canWrite: boolean; canDraft: boolean }) {
  if (!meetingSourceBroker || isLocalDataRuntime() || !canWrite) return null;
  return <ConnectedMeetingSources societyId={societyId} meetingId={meetingId} canDraft={canDraft} />;
}

function ConnectedMeetingSources({ societyId, meetingId, canDraft }: { societyId: string; meetingId: string; canDraft: boolean }) {
  const [sources, setSources] = useState<MeetingSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState<MeetingSource | null>(null);
  const [filePreview, setFilePreview] = useState<MeetingSource | null>(null);
  const loadPreview = useCallback(async (signal: AbortSignal) => {
    if (!filePreview || filePreview.size > MAX_FILE_PREVIEW_BYTES) throw new Error("Choose Download original for files above 25 MB.");
    const blob = await downloadMeetingSourceBlob(filePreview.size, meetingRecordingMimeType(filePreview.fileName), { fetchRange: meetingSourceRangeFetcher(filePreview.id), signal });
    signal.throwIfAborted();
    return blob.arrayBuffer();
  }, [filePreview]);
  const [preview, setPreview] = useState<MeetingSource | null>(null);
  const [page, setPage] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const appendText = useMutation(api.meetingSources.appendText);
  const selectTranscript = useMutation(api.meetingSources.useTranscript);
  const transcribe = useAction(api.meetingSourceSpeech.start);
  const speech = useQuery(api.meetingSources.speechCapabilities, { meetingId }) as { configured: boolean } | undefined;
  // Timed files (.vtt/.srt/.json, or the one inside a ZIP) can also become the timed working transcript.
  const [timedOffer, setTimedOffer] = useState<TimedOffer | null>(null);
  const importTimed = usePermissionedMutation(typedApi.transcripts.importTimed, true);
  const workingTranscript = useQuery(typedApi.transcripts.getByMeeting, { meetingId: meetingId as Id<"meetings"> });
  const confirm = useConfirm();
  const [, setSearchParams] = useSearchParams();
  const textPage = useQuery(api.meetingSources.textPage, preview ? { sourceId: preview.id, index: page } : "skip") as { text: string } | null | undefined;
  const refresh = useCallback(async () => { const rows = await sourceRequest("list", { meetingId }); setSources(rows); }, [meetingId]);
  useEffect(() => {
    let mounted = true;
    setSources([]); setFilePreview(null); setActive(null); setPreview(null); setPage(0); setError("");
    sourceRequest("list", { meetingId }).then(rows => { if (mounted) setSources(rows); }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; controller.current?.abort(); };
  }, [meetingId]);
  const hasSpeechJob = sources.some(source => source.jobStatus === "processing");
  useEffect(() => { if (!hasSpeechJob) return; const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 10_000); return () => window.clearInterval(timer); }, [hasSpeechJob, refresh]);

  async function upload(file: File) {
    setBusy(true); setActive(null); setError(""); setTimedOffer(null); setMessage("Checking the file so uploads can resume safely…");
    const abort = new AbortController(); controller.current = abort;
    // Parsed while the browser still has the File; offered once the original is attached.
    const timed = timedTranscriptOffer(file).catch(() => null);
    try {
      const source = await uploadMeetingSource(file, meetingId, state => { setActive(state); setMessage(state.status === "verifying" ? "Verifying the stored file…" : "Uploading to private meeting storage…"); }, abort.signal);
      setMessage("Original attached and verified.");
      if (/\.(txt|vtt|srt|json|zip)$/i.test(file.name)) {
        setMessage("Original attached. Importing transcript text…");
        let index = 0; let pending: string | undefined;
        for await (const text of meetingTranscriptChunks(file)) {
          abort.signal.throwIfAborted();
          if (pending !== undefined) await appendText({ sourceId: source.id, index: index++, text: pending, complete: false });
          pending = text;
        }
        if (pending === undefined || index === 0 && !pending.trim()) throw new Error("The original is attached, but it contains no transcript text.");
        await appendText({ sourceId: source.id, index, text: pending, complete: true });
        setMessage("Original attached. Transcript imported; review it below before using it for minutes.");
        const parsed = await timed;
        if (parsed) setTimedOffer({ ...parsed, sourceName: file.name });
      } else setMessage(speech?.configured ? "Recording attached and verified. Choose Transcribe to create its transcript." : "Recording attached and verified. Speech processing is not configured yet; you can upload an existing transcript.");
    } catch (e) {
      if (abort.signal.aborted) setMessage("Paused. Choose the same file to resume. If a chunk was in flight, wait 90 seconds first.");
      else setError(e instanceof Error ? e.message : "Upload failed.");
    } finally { setBusy(false); controller.current = null; await refresh().catch(() => undefined); }
  }

  // Choose or drop a file onto the card. Size and name checks stay with
  // uploadMeetingSource (500 MB, decimal) so its messages are unchanged; only
  // the type is checked here, with the protocol's wording. No paste: these
  // are recordings and exports, not screenshots.
  const drop = useFileDrop({
    accept: SOURCE_ACCEPT,
    disabled: busy,
    onFiles: ([file]) => { if (file) void upload(file); },
    onReject: () => setError("Choose TXT, VTT, SRT, Whisper JSON/ZIP, or an audio/video recording."),
  });
  const { onDragEnter, onDragOver, onDragLeave, onDrop } = drop.rootProps;

  async function openInTranscriptTab(offer: TimedOffer) {
    if (workingTranscript && !(await confirm(REPLACE_TRANSCRIPT_CONFIRM))) return;
    setError("");
    try {
      const { provider, segments, durationSeconds } = offer;
      await importTimed({ societyId: societyId as Id<"societies">, meetingId: meetingId as Id<"meetings">, provider, segments, durationSeconds });
      setTimedOffer(null);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set("tab", "transcript");
        if (needsSpeakerReview(segments)) next.set("intent", REVIEW_SPEAKERS_INTENT);
        return next;
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open the transcript."); }
  }

  async function download(source: MeetingSource) {
    setError("");
    try {
      // Chrome can stream directly to disk; other browsers use their Blob download path.
      const picker = (window as any).showSaveFilePicker;
      const handle = picker ? await picker({ suggestedName: source.fileName }) : null;
      const writable = handle ? await handle.createWritable() : null; const parts: Blob[] = [];
      try {
        await downloadMeetingSourceRanges(source.size, { fetchRange: meetingSourceRangeFetcher(source.id), onPart: async part => { if (writable) await writable.write(part); else parts.push(part); } });
        if (writable) await writable.close();
        else { const url = URL.createObjectURL(new Blob(parts)); const anchor = document.createElement("a"); anchor.href = url; anchor.download = source.fileName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      } catch (e) { await writable?.abort().catch(() => undefined); throw e; }
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Download failed."); }
  }

  return <section className={`card meeting-notes-card file-drop-target is-${drop.dragState}`} aria-label="Meeting source files" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {filePreview && <FilePreviewDialog file={{ id: filePreview.id, name: filePreview.fileName, bytes: filePreview.size }} loadBytes={loadPreview} onClose={() => setFilePreview(null)} onDownload={() => void download(filePreview)} />}
    <div className="card__head"><h3>Meeting source files</h3></div>
    <div className="card__body">
      <p>Attach transcripts, audio, video or Whisper ZIP exports up to 500 MB per file. Originals stay in private Microsoft storage. Only meeting editors can access these working files.</p>
      {speech && !speech.configured && <p>Automatic audio/video transcription needs a speech processor and provider key. Recording uploads and existing transcript imports are available.</p>}
      <input {...drop.inputProps} />
      <button className="btn" type="button" disabled={busy} onClick={drop.open}>Choose file / resume upload</button>{" "}
      {busy && <button className="btn" type="button" onClick={() => controller.current?.abort()}>Pause</button>}
      {busy && active && <div><progress aria-label={active.status === "verifying" ? "Verifying stored file" : "Uploading file"} max={active.size} value={active.status === "verifying" ? active.verifiedOffset : active.offset} /> {Math.round(100 * (active.status === "verifying" ? active.verifiedOffset : active.offset) / active.size)}%</div>}
      {message && <p role="status">{message}</p>}
      {timedOffer && <p>
        {timedOffer.sourceName} has timings{timedOffer.segments.some(segment => segment.speaker !== "Speaker") ? " and speakers" : ""} ({timedOffer.segments.length.toLocaleString()} segments). Open it in the Transcript tab to read it with the recording and name the speakers.{" "}
        <button className="btn btn--sm" type="button" disabled={busy} onClick={() => void openInTranscriptTab(timedOffer)}>Open in Transcript tab</button>
      </p>}
      {error && <p role="alert">{error}</p>}
      <ul>{sources.map(source => <li key={source.id} style={{ marginBlock: "0.75rem" }}>
        <strong>{source.fileName}</strong> · {(source.size / 1_000_000).toFixed(1)} MB · {source.status}
        {source.status === "ready" && <>{" "}<button className="btn btn--sm" type="button" onClick={() => setFilePreview(source)}>Preview file</button>{" "}<button className="btn btn--sm" type="button" onClick={() => void download(source)}>Download original</button></>}
        {source.status === "ready" && source.kind === "recording" && !source.textComplete && <>{" "}<button className="btn btn--sm" type="button" disabled={busy || !speech?.configured || source.jobStatus === "processing"} onClick={async () => {
          if (!(await confirm({ title: "Transcribe recording?", message: "Transcribe this recording using the configured speech provider? Its usage charges apply.", confirmLabel: "Start transcription", tone: "warn" }))) return;
          try { await transcribe({ sourceId: source.id }); await refresh(); setMessage("Speech processing started. You can leave this meeting while it runs."); } catch (e) { setError(e instanceof Error ? e.message : "Speech processing could not start."); }
        }}>{source.jobStatus === "processing" ? "Transcribing…" : "Transcribe"}</button></>}
        {source.jobError && <p role="status">{source.jobError}</p>}
        {source.textComplete && <>{" "}<button className="btn btn--sm" type="button" onClick={() => { setPreview(source); setPage(0); }}>Read transcript</button></>}
        {canDraft && source.textComplete && (source.textBytes ?? 0) <= MEETING_TRANSCRIPT_MAX_BYTES && <>{" "}<button className="btn btn--sm" type="button" disabled={busy} onClick={async () => {
          if (!(await confirm({ title: "Use this transcript for the meeting?", message: "This replaces the current working transcript. Existing minutes text stays as it is.", confirmLabel: "Use transcript", tone: "warn" }))) return;
          try { await selectTranscript({ sourceId: source.id }); setMessage("Working transcript updated. You can now draft minutes from the transcript card."); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); }
        }}>Use for minutes</button></>}
        {source.textComplete && (source.textBytes ?? 0) > MEETING_TRANSCRIPT_MAX_BYTES && <p>This large transcript can be read in pages. Choose a shorter excerpt in the transcript editor for AI drafting.</p>}
        {!["ready", "cancelled"].includes(source.status) && <>{" "}<button className="btn btn--sm" type="button" disabled={busy} onClick={async () => { try { await sourceRequest("cancel", { sourceId: source.id }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Cancellation failed."); } }}>Cancel upload</button></>}
      </li>)}</ul>
      {preview && <div><h4>{preview.fileName} — transcript</h4><p>Page {page + 1} of {preview.textChunks}</p>
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: "24rem", overflow: "auto" }}>{textPage?.text ?? "Loading…"}</pre>
        <button className="btn btn--sm" type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>{" "}
        <button className="btn btn--sm" type="button" disabled={page + 1 >= (preview.textChunks ?? 0)} onClick={() => setPage(p => p + 1)}>Next</button>{" "}
        <button className="btn btn--sm" type="button" onClick={() => setPreview(null)}>Close transcript</button>
      </div>}
    </div>
  </section>;
}
