import { usePermissions } from "@/hooks/usePermissions";
import { Link } from "react-router-dom";
import { DEVICE_AI_SETTINGS_HREF, useAiDraftAvailability } from "../../../lib/localAi/useDeviceAi";
import { Mic, Save, Sparkles, Upload } from "lucide-react";
import { Badge } from "../../../components/ui";
import { DeviceDraftStatus } from "./DeviceDraftStatus";

export function MeetingTranscriptCard({
  meetingId,
  vttInputRef,
  audioInputRef,
  transcriptOnFile,
  transcriptProvider,
  transcriptionJob,
  transcriptStatusTone,
  transcriptEdit,
  savingTranscript,
  pipelineBusy,
  audioFile,
  importNote,
  hasMinutes,
  draftingFromTranscript = false,
  setTranscriptEdit,
  setAudioFile,
  onImportVtt,
  onSaveTranscript,
  onUploadAudioAndRun,
  onDraftFromTranscript,
}: {
  /** For the on-device draft progress and Cancel. */
  meetingId?: string;
  vttInputRef: any;
  audioInputRef: any;
  transcriptOnFile: string;
  transcriptProvider: string | null;
  transcriptionJob: any;
  transcriptStatusTone: "success" | "danger" | "warn";
  transcriptEdit: string | null;
  savingTranscript: boolean;
  pipelineBusy: boolean;
  audioFile: File | null;
  importNote: string | null;
  hasMinutes: boolean;
  /** True while the transcript-based draft action is running. */
  draftingFromTranscript?: boolean;
  setTranscriptEdit: (value: string | null) => void;
  setAudioFile: (value: File | null) => void;
  onImportVtt: (file: File) => Promise<void>;
  onSaveTranscript: () => Promise<void>;
  onUploadAudioAndRun: (draftMinutes: boolean) => Promise<void> | void;
  /** Triggers AI draft from the transcript already on file. Optional — older
   * callers that don't pass this just won't render the button. */
  onDraftFromTranscript?: () => Promise<void> | void;
}) {
  // Re-drafting is allowed even when minutes already exist; the parent
  // callback handles the overwrite confirmation when appropriate.
  const { can } = usePermissions();
  const canWrite = can("meetings:write");
  const canDraft = can("minutes:write");
  // Drafting runs on the server or the on-device model; audio transcription is server-only for now.
  const ai = useAiDraftAvailability();
  const remoteAvailable = ai.server;
  const canDraftFromTranscript =
    !!onDraftFromTranscript && transcriptOnFile.trim().length > 0;
  return (
    <div id="meeting-transcript-card" className="card meeting-notes-card">
      <div className="card__head">
        <h2 className="card__title">
          <Mic size={14} />
          Transcript / notes
        </h2>
        <span className="card__subtitle">
          {transcriptOnFile
            ? `${transcriptOnFile.length.toLocaleString()} characters on file`
            : "No audio transcript on file"}
        </span>
        {transcriptProvider && <Badge tone="info">{transcriptProvider}</Badge>}
        {transcriptionJob && (
          <Badge tone={transcriptStatusTone}>
            {transcriptionJob.status} ({transcriptionJob.provider})
          </Badge>
        )}
      </div>
      <input
        ref={vttInputRef}
        type="file"
        accept=".vtt,text/vtt"
        style={{ display: "none" }}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            if (canWrite) await onImportVtt(file);
          } finally {
            if (vttInputRef.current) vttInputRef.current.value = "";
          }
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,video/*"
        style={{ display: "none" }}
        onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
      />
      <div className="card__body meeting-notes-body">
        {transcriptEdit !== null ? (
          <textarea
            className="textarea meeting-notes-editor"
            readOnly={!canWrite}
            value={transcriptEdit}
            onChange={(event) => setTranscriptEdit(event.target.value)}
            placeholder="Add meeting notes or paste the raw transcript here."
          />
        ) : transcriptOnFile ? (
          <pre className="meeting-transcript-preview">{transcriptOnFile}</pre>
        ) : importNote ? (
          <div className="meeting-note">
            <div className="meeting-note__title">Import note</div>
            <p>{importNote}</p>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            No notes added yet.
          </div>
        )}

        <div className="meeting-notes-actions">
          {transcriptEdit === null ? (
            <>
              <button
                className="btn-action"
                disabled={!canWrite || (savingTranscript || pipelineBusy)}
                onClick={() => setTranscriptEdit(transcriptOnFile)}
              >
                {transcriptOnFile ? "Edit" : "Add notes"}
              </button>
              <button
                className="btn-action"
                disabled={!canWrite || (savingTranscript || pipelineBusy)}
                onClick={() => vttInputRef.current?.click()}
              >
                <Upload size={12} /> Import VTT
              </button>
              <button
                className="btn-action"
                disabled={!canWrite || (savingTranscript || pipelineBusy)}
                onClick={() => audioInputRef.current?.click()}
              >
                <Upload size={12} /> {audioFile ? "Change audio" : "Choose audio"}
              </button>
              {canDraftFromTranscript && (
                <button
                  className="btn-action btn-action--primary"
                  disabled={!canDraft || (!ai.available || savingTranscript || pipelineBusy || draftingFromTranscript)}
                  onClick={() => { if (canDraft) onDraftFromTranscript?.(); }}
                  title={ai.device ? `Generate a minutes draft with the on-device model ${ai.deviceModel}.` : "Generate a minutes draft from the saved transcript using AI."}
                >
                  <Sparkles size={12} /> {draftingFromTranscript ? "Drafting..." : "Draft from transcript"}
                </button>
              )}
            </>
          ) : (
            <>
              <button className="btn-action" onClick={() => setTranscriptEdit(null)}>
                Cancel
              </button>
              <button
                className="btn-action btn-action--primary"
                disabled={!canWrite || (savingTranscript)}
                onClick={() => { if (canWrite) void onSaveTranscript(); }}
              >
                <Save size={12} /> {savingTranscript ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </div>

        {meetingId && <DeviceDraftStatus meetingId={meetingId} />}
        {!remoteAvailable && (ai.device ? (
          <p className="muted" role="status">On-device model: {ai.deviceModel}. To transcribe a recording on this device, open it in the Transcript tab.</p>
        ) : (
          <p className="muted" role="status">
            AI minutes drafting and audio transcription require a connected server. Saved text transcripts remain available.
            {ai.canSetUpDevice && <> <Link to={DEVICE_AI_SETTINGS_HREF}>Set up on-device AI in Settings</Link></>}
          </p>
        ))}
        <div className="meeting-audio-tools">
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            VTT/audio imports are optional.
          </div>
          <div className="meeting-audio-actions">
            {audioFile ? (
              <Badge tone="info">{audioFile.name}</Badge>
            ) : (
              <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>No audio selected.</span>
            )}
            <button className="btn-action" onClick={() => audioInputRef.current?.click()} disabled={!canWrite}>
              <Upload size={12} /> {audioFile ? "Change file" : "Choose file"}
            </button>
            <button
              className="btn-action btn-action--primary"
              disabled={!canWrite || (!remoteAvailable || !audioFile || pipelineBusy)}
              onClick={() => { if (canWrite) onUploadAudioAndRun(false); }}
            >
              <Mic size={12} /> {pipelineBusy ? "Transcribing..." : "Transcribe"}
            </button>
            {!hasMinutes && (
              <button
                className="btn-action"
                disabled={!canDraft || (!remoteAvailable || !audioFile || pipelineBusy)}
                onClick={() => { if (canWrite && canDraft) onUploadAudioAndRun(true); }}
              >
                <Sparkles size={12} /> {pipelineBusy ? "Running..." : "Draft minutes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
