import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AudioLines, Captions, CloudDownload, FolderOpen, Loader2, Sparkles, Upload, X } from "lucide-react";
import { Badge } from "../../../components/ui";
import { meetingSourceBroker } from "../../../lib/meetingSourceUpload";
import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { AttachedRecordingsPanel, formatRecordingSize } from "./AttachedRecordingsPanel";
import { useAttachedSharePointRecording } from "./useAttachedSharePointRecording";
import type { RecordingOrigin, RememberedRecording } from "./useTranscriptRecording";
import { DEVICE_AI_SETTINGS_HREF } from "../../../lib/localAi/useDeviceAi";
import { describeTranscriptionStep, type LocalTranscriptionJob } from "./useLocalTranscription";
import { formatTranscriptTime } from "./activeIndex";
import { DeviceDraftStatus } from "../components/DeviceDraftStatus";

/** The recording open in the player. `duration` is 0 until its metadata loads. */
export type OpenRecording = { name: string; origin?: RecordingOrigin; size: number; duration: number };

/** What the header needs from `useLocalTranscription`. */
export type LocalTranscriptionControls = {
  available: boolean;
  canSetUp: boolean;
  serverHost: string;
  job: LocalTranscriptionJob | null;
  error: { message: string; hint?: string } | null;
  dismissError: () => void;
  start: () => Promise<void>;
  cancel: () => void;
};

export function TranscriptWorkspaceHeader({
  meetingId,
  provider,
  recording,
  localTranscription,
  reopenHint,
  canWrite,
  importing,
  importFile,
  setRecording,
  onDraftMinutes,
  draftUnavailableReason,
  draftSetUpHref,
  draftingMinutes,
}: {
  meetingId: string;
  provider?: string;
  recording?: OpenRecording;
  localTranscription?: LocalTranscriptionControls;
  /** Set when a transcript exists but no recording is open (recordings are not kept across reloads). */
  reopenHint?: { lastRecording: RememberedRecording | null };
  canWrite: boolean;
  importing: boolean;
  importFile: (file: File) => Promise<void>;
  setRecording: (file: File, origin?: RecordingOrigin) => void;
  onDraftMinutes?: () => Promise<void> | void;
  /** Renders the draft button disabled with this visible explanation. */
  draftUnavailableReason?: string;
  /** Shown after the explanation when on-device AI could be set up here. */
  draftSetUpHref?: string;
  draftingMinutes?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const attachedToggle = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const attachedPanelId = `${ids}-attached`;
  const draftNoteId = `${ids}-draft-note`;
  const [attachedOpen, setAttachedOpen] = useState(false);
  // Raw recordings are restricted to meeting editors on a connected deployment
  // with the transfer broker, the same gate as Meeting source files.
  const attachedAvailable = Boolean(meetingSourceBroker) && !isLocalDataRuntime() && canWrite;
  const onAttachedLoaded = useCallback(
    (file: File) => {
      setRecording(file, "attached");
      setAttachedOpen(false);
      attachedToggle.current?.focus();
    },
    [setRecording],
  );
  const attached = useAttachedSharePointRecording(meetingId, onAttachedLoaded);
  const draftUnavailable = Boolean(draftUnavailableReason);
  return (
    <>
      <header className="transcript-toolbar">
        <div className="transcript-toolbar__title">
          <h2>
            <AudioLines size={18} />
            Transcript
          </h2>
          {provider && <Badge tone="info">{provider}</Badge>}
        </div>
        <div className="transcript-toolbar__actions">
          <button type="button" className="btn-action" onClick={() => mediaInput.current?.click()}>
            <FolderOpen size={15} />
            <span className="transcript-label-full">{recording ? "Change recording" : "Open recording"}</span>
            <span className="transcript-label-short">Recording</span>
          </button>
          {attachedAvailable && (
            <button
              ref={attachedToggle}
              type="button"
              className="btn-action"
              aria-expanded={attachedOpen}
              aria-controls={attachedPanelId}
              onClick={() => {
                if (!attachedOpen) void attached.refresh();
                setAttachedOpen(!attachedOpen);
              }}
            >
              <CloudDownload size={15} />
              <span className="transcript-label-full">Attached recordings</span>
              <span className="transcript-label-short">Attached</span>
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              className="btn-action"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={15} />
              <span className="transcript-label-full">{importing ? "Importing…" : "Import transcript"}</span>
              <span className="transcript-label-short">{importing ? "Importing…" : "Import"}</span>
            </button>
          )}
          {localTranscription?.available && <TranscribeOnDeviceButton controls={localTranscription} importing={importing} />}
          {onDraftMinutes && (
            <DraftMinutesButton
              onDraft={onDraftMinutes}
              drafting={Boolean(draftingMinutes)}
              unavailableReason={draftUnavailableReason}
              noteId={draftNoteId}
            />
          )}
        </div>
        {onDraftMinutes && <DeviceDraftStatus meetingId={meetingId} className="transcript-toolbar__note" />}
        {onDraftMinutes && draftUnavailable && (
          <p id={draftNoteId} className="transcript-muted transcript-toolbar__note">
            {draftUnavailableReason}
            {draftSetUpHref && <> <Link to={draftSetUpHref}>Set up on-device AI in Settings</Link></>}
          </p>
        )}
        {attachedAvailable && attachedOpen && (
          <AttachedRecordingsPanel id={attachedPanelId} attached={attached} />
        )}
        {attachedAvailable && !attachedOpen && attached.download && (
          <p className="transcript-muted transcript-toolbar__note" role="status">
            Downloading {attached.download.fileName}…
          </p>
        )}
        <RecordingNote recording={recording} reopenHint={attached.download ? undefined : reopenHint} />
        {localTranscription && recording && <LocalTranscriptionStatus controls={localTranscription} />}
      </header>
      <input
        ref={mediaInput}
        type="file"
        accept="audio/*,video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            // A device file replaces any attached recording still downloading.
            attached.cancel();
            setRecording(file);
          }
          event.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".vtt,.srt,.json,text/vtt,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && canWrite) void importFile(file);
          event.target.value = "";
        }}
      />
    </>
  );
}

/**
 * The open recording, or (recordings are never uploaded, so they are gone after a
 * reload) a hint to open it again, naming the last file opened for this meeting.
 */
function RecordingNote({
  recording,
  reopenHint,
}: {
  recording?: OpenRecording;
  reopenHint?: { lastRecording: RememberedRecording | null };
}) {
  if (recording)
    return (
      <p className="transcript-source">
        <span aria-hidden="true" />
        <span>
          {recording.name} · {formatRecordingSize(recording.size)} ·{" "}
          {recording.duration ? `${formatTranscriptTime(recording.duration)} · ` : ""}
          {recording.origin === "attached"
            ? "downloaded from meeting storage, plays in this browser"
            : "plays on this device, never uploaded"}
        </span>
      </p>
    );
  if (!reopenHint) return null;
  const { lastRecording } = reopenHint;
  return (
    <p className="transcript-muted transcript-toolbar__note">
      {lastRecording
        ? `Open the recording again to play — recordings stay on your device. Last opened: ${lastRecording.name} (${formatRecordingSize(lastRecording.size)}).`
        : "Open the meeting recording to play along — it stays on your device."}
    </p>
  );
}

function DraftMinutesButton({
  onDraft,
  drafting,
  unavailableReason,
  noteId,
}: {
  onDraft: () => Promise<void> | void;
  drafting: boolean;
  unavailableReason?: string;
  noteId: string;
}) {
  return (
    <button
      type="button"
      className="btn btn--primary"
      disabled={drafting || Boolean(unavailableReason)}
      aria-busy={drafting || undefined}
      aria-describedby={unavailableReason ? noteId : undefined}
      title={unavailableReason ?? "Generate a minutes draft from this transcript using AI."}
      onClick={() => void onDraft()}
    >
      {drafting ? (
        <Loader2 size={15} className="spin" aria-hidden="true" />
      ) : (
        <Sparkles size={15} aria-hidden="true" />
      )}
      <span className="transcript-label-full">
        {drafting ? "Drafting minutes…" : "Draft minutes from transcript"}
      </span>
      <span className="transcript-label-short">{drafting ? "Drafting…" : "Draft minutes"}</span>
    </button>
  );
}

function TranscribeOnDeviceButton({ controls, importing }: { controls: LocalTranscriptionControls; importing: boolean }) {
  const transcribing = Boolean(controls.job);
  const label = transcribing ? "Transcribing…" : "Transcribe on this device";
  return (
    <button
      type="button"
      className="btn-action"
      disabled={transcribing || importing}
      aria-busy={transcribing || undefined}
      title={`Transcribe this recording with the speech-to-text server in Settings${controls.serverHost ? ` (${controls.serverHost})` : ""}.`}
      onClick={() => void controls.start()}
    >
      {transcribing ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Captions size={15} aria-hidden="true" />}
      <span className="transcript-label-full">{label}</span>
      <span className="transcript-label-short">{transcribing ? "Transcribing…" : "Transcribe"}</span>
    </button>
  );
}

/**
 * Progress and Cancel while transcribing on this device; afterwards, an error
 * (with the CORS hint in a browser), or where to set speech-to-text up.
 */
function LocalTranscriptionStatus({ controls }: { controls: LocalTranscriptionControls }) {
  const { job, error, canSetUp, serverHost } = controls;
  const elapsed = useElapsed(job?.startedAt);
  if (job) {
    const { label, value } = describeTranscriptionStep(job.step, serverHost);
    return (
      <div className="transcript-local-stt" role="status" aria-live="polite">
        <div className="transcript-local-stt__text">
          <strong>{label}</strong>
          <span className="transcript-muted">
            {job.fileName} · {formatTranscriptTime(elapsed)} elapsed. Long recordings can take a while; the transcript is saved when it finishes.
          </span>
        </div>
        <progress max={1} value={value ?? undefined} aria-label="Transcription progress" />
        <button type="button" className="btn-action" onClick={controls.cancel}>
          <X size={15} aria-hidden="true" />
          Cancel
        </button>
      </div>
    );
  }
  if (error)
    return (
      <div className="transcript-local-stt transcript-local-stt--error" role="alert">
        <div className="transcript-local-stt__text">
          <strong>{error.message}</strong>
          {error.hint && <span className="transcript-muted">{error.hint}</span>}
        </div>
        <button type="button" className="btn-action" onClick={controls.dismissError}>
          Dismiss
        </button>
      </div>
    );
  if (canSetUp)
    return (
      <p className="transcript-muted transcript-toolbar__note">
        To transcribe this recording on this device, <Link to={DEVICE_AI_SETTINGS_HREF}>set up speech-to-text in Settings</Link>.
      </p>
    );
  return null;
}

/** Whole seconds since `startedAt`, ticking once a second. */
function useElapsed(startedAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
}
