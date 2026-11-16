/**
 * "Recordings" for a meeting whose workspace keeps recordings in its own file
 * storage (hosted native storage) or on this computer (desktop app). SharePoint
 * workspaces use Meeting source files instead; a workspace that keeps
 * transcripts only, or a browser-only workspace, keeps none.
 *
 * Raw recordings are for meeting editors (meetings:write), like source files.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { useNavigate } from "react-router-dom";
import { AudioLines, Download, Play, Trash2, Upload, Wand2, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "@/components/ui";
import { useConfirm } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/format";
import { getDesktopBridge } from "../../../lib/desktopBridge";
import { triggerBlobDownload } from "../../../lib/zip";
import { MEETING_RECORDING_ACCEPT, MEETING_RECORDING_MAX_BYTES } from "../../../../shared/meetingRecordingStorage";
import { formatRecordingSize } from "../transcript/AttachedRecordingsPanel";
import { ATTACHED_RECORDINGS_INTENT } from "../transcript/timedImportOffer";
import {
  fetchWorkspaceRecording,
  postToUploadUrl,
  useMeetingRecordingStore,
  writeDesktopRecording,
  type WorkspaceRecording,
} from "./workspaceRecordings";

type Upload = { fileName: string; sent: number; total: number };

export function MeetingRecordingsCard({ societyId, meetingId, canWrite, canTranscribe, hasTranscript }: {
  societyId: string;
  meetingId: string;
  canWrite: boolean;
  /** minutes:write: replacing the working transcript is for minute-takers (decision A1). */
  canTranscribe: boolean;
  hasTranscript: boolean;
}) {
  const store = useMeetingRecordingStore(canWrite ? societyId : undefined);
  if (!canWrite || !store || (store.store !== "workspace" && store.store !== "device")) return null;
  return (
    <KeptRecordings
      societyId={societyId}
      meetingId={meetingId}
      desktop={store.store === "device"}
      where={store.label}
      serverTranscriptionMax={store.store === "workspace" && canTranscribe ? store.settings.serverTranscription?.maxBytes : undefined}
      hasTranscript={hasTranscript}
    />
  );
}

function KeptRecordings({ societyId, meetingId, desktop, where, serverTranscriptionMax, hasTranscript }: {
  societyId: string;
  meetingId: string;
  desktop: boolean;
  where: string;
  serverTranscriptionMax?: number;
  hasTranscript: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const recordings = useQuery(api.meetingRecordings.list, { meetingId: meetingId as any }) as WorkspaceRecording[] | undefined;
  const generateUploadUrl = useMutation(api.meetingRecordings.generateUploadUrl);
  const attach = useMutation(api.meetingRecordings.attach);
  const remove = useMutation(api.meetingRecordings.remove);
  const transcribe = useAction(api.transcripts.runPipeline);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [transcribing, setTranscribing] = useState<string | null>(null);

  const add = async (file: File) => {
    if (file.size > MEETING_RECORDING_MAX_BYTES) {
      toast.error("That recording is too large", "Recordings can be up to 500 MB.");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setUpload({ fileName: file.name, sent: 0, total: file.size });
    try {
      if (desktop) {
        const ref = await writeDesktopRecording({ societyId, meetingId, file });
        await attach({ meetingId: meetingId as any, fileName: file.name, size: ref.byteLength ?? file.size, mimeType: ref.mimeType, provider: "local-filesystem", storageKey: ref.key, sha256: ref.sha256 });
      } else {
        const url = await generateUploadUrl({ meetingId: meetingId as any, fileName: file.name, size: file.size });
        const storageId = await postToUploadUrl(url, file, (sent, total) => setUpload({ fileName: file.name, sent, total }), abort.signal);
        await attach({ meetingId: meetingId as any, fileName: file.name, storageId: storageId as any });
      }
      toast.success("Recording saved", file.name);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") toast.info("Upload cancelled.");
      else toast.error("Could not save the recording", error instanceof Error ? error.message : String(error));
    } finally {
      controller.current = null;
      setUpload(null);
    }
  };

  const download = async (recording: WorkspaceRecording) => {
    try {
      if (recording.provider === "local-filesystem") {
        await getDesktopBridge()?.openDocumentVersion({ key: recording.storageKey });
        return;
      }
      triggerBlobDownload(await fetchWorkspaceRecording(recording, () => undefined), recording.fileName);
    } catch (error) {
      toast.error("Could not download the recording", error instanceof Error ? error.message : String(error));
    }
  };

  const runTranscription = async (recording: WorkspaceRecording) => {
    if (hasTranscript) {
      const ok = await confirm({
        title: "Replace the working transcript?",
        message: "The server transcribes this recording and replaces the meeting's working transcript, its edits and speaker names. Approved minutes stay unchanged.",
        confirmLabel: "Transcribe",
        tone: "warn",
      });
      if (!ok) return;
    }
    setTranscribing(recording.id);
    try {
      await transcribe({
        societyId: societyId as any,
        meetingId: meetingId as any,
        storageId: recording.storageKey as any,
        sourceFileName: recording.fileName,
        sourceMimeType: recording.mimeType,
        draftMinutes: false,
      });
      toast.success("Transcript ready", "Open the Transcript tab to read it and name the speakers.");
    } catch (error) {
      toast.error("Could not transcribe the recording", error instanceof Error ? error.message : String(error));
    } finally {
      setTranscribing(null);
    }
  };

  const removeRecording = async (recording: WorkspaceRecording) => {
    const ok = await confirm({
      title: `Remove ${recording.fileName}?`,
      message: desktop
        ? "The recording is removed from this meeting. Its transcript, notes and tasks stay."
        : "The recording is deleted from workspace storage. Its transcript, notes and tasks stay.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove({ id: recording.id as any });
    } catch (error) {
      toast.error("Could not remove the recording", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="card meeting-recordings" aria-labelledby={`meeting-recordings-${meetingId}`}>
      <div className="card__head meeting-recordings__head">
        <h2 className="card__title" id={`meeting-recordings-${meetingId}`}>
          <AudioLines size={14} aria-hidden="true" /> Recordings
        </h2>
        <Badge tone="neutral">{where}</Badge>
        <button type="button" className="btn-action" onClick={() => input.current?.click()} disabled={Boolean(upload)}>
          <Upload size={12} aria-hidden="true" /> Add recording
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept={MEETING_RECORDING_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void add(file);
          }}
        />
      </div>
      <div className="card__body meeting-recordings__body">
        {upload && <UploadStatus upload={upload} onCancel={desktop ? undefined : () => controller.current?.abort()} />}
        {recordings && !recordings.length && !upload && (
          <p className="muted">No recordings yet. Add the audio or video of this meeting to play it beside the transcript and transcribe it.</p>
        )}
        {recordings && recordings.length > 0 && (
          <ul className="meeting-recordings__list">
            {recordings.map((recording) => (
              <RecordingRow
                key={recording.id}
                recording={recording}
                serverTranscriptionMax={serverTranscriptionMax}
                transcribing={transcribing}
                onPlay={() => navigate({ search: `?tab=transcript&intent=${ATTACHED_RECORDINGS_INTENT}` })}
                onDownload={() => { void download(recording); }}
                onTranscribe={() => { void runTranscription(recording); }}
                onRemove={() => { void removeRecording(recording); }}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RecordingRow({ recording, serverTranscriptionMax, transcribing, onPlay, onDownload, onTranscribe, onRemove }: {
  recording: WorkspaceRecording;
  serverTranscriptionMax?: number;
  transcribing: string | null;
  onPlay: () => void;
  onDownload: () => void;
  onTranscribe: () => void;
  onRemove: () => void;
}) {
  const tooLargeForServer = serverTranscriptionMax !== undefined && recording.size > serverTranscriptionMax;
  return (
    <li className="meeting-recordings__item">
      <div className="meeting-recordings__meta">
        <strong>{recording.fileName}</strong>
        <span className="muted">{formatRecordingSize(recording.size)} · {formatDateTime(recording.createdAtISO)}</span>
      </div>
      <div className="meeting-recordings__actions">
        <button
          type="button"
          className="btn-action"
          onClick={onPlay}
        >
          <Play size={12} aria-hidden="true" /> Play in Transcript tab
        </button>
        <button type="button" className="btn-action" onClick={onDownload}>
          <Download size={12} aria-hidden="true" /> {recording.provider === "local-filesystem" ? "Open" : "Download"}
        </button>
        {serverTranscriptionMax !== undefined && (
          <button
            type="button"
            className="btn-action"
            disabled={Boolean(transcribing) || tooLargeForServer}
            title={tooLargeForServer ? `The server transcribes recordings up to ${formatRecordingSize(serverTranscriptionMax)}. Play it in the Transcript tab and transcribe it on this device instead.` : undefined}
            onClick={onTranscribe}
          >
            <Wand2 size={12} aria-hidden="true" /> {transcribing === recording.id ? "Transcribing…" : "Transcribe"}
          </button>
        )}
        <button
          type="button"
          className="btn-action btn-action--icon"
          aria-label={`Remove ${recording.fileName}`}
          onClick={onRemove}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function UploadStatus({ upload, onCancel }: { upload: Upload; onCancel?: () => void }) {
  return (
    <div className="meeting-recordings__progress" role="status">
      <span>Saving {upload.fileName}…</span>
      <progress max={upload.total} value={upload.sent} aria-label={`Saving ${upload.fileName}`} />
      {onCancel && (
        <button type="button" className="btn-action" onClick={onCancel}>
          <X size={12} aria-hidden="true" /> Cancel
        </button>
      )}
    </div>
  );
}
