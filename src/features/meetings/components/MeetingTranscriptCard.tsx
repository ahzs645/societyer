import { Mic, Save, Sparkles, Upload } from "lucide-react";
import { Badge } from "../../../components/ui";

export function MeetingTranscriptCard({
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
  setTranscriptEdit,
  setAudioFile,
  onImportVtt,
  onSaveTranscript,
  onUploadAudioAndRun,
}: {
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
  setTranscriptEdit: (value: string | null) => void;
  setAudioFile: (value: File | null) => void;
  onImportVtt: (file: File) => Promise<void>;
  onSaveTranscript: () => Promise<void>;
  onUploadAudioAndRun: (draftMinutes: boolean) => Promise<void> | void;
}) {
  return (
    <div className="card meeting-notes-card">
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
            await onImportVtt(file);
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
                disabled={savingTranscript || pipelineBusy}
                onClick={() => setTranscriptEdit(transcriptOnFile)}
              >
                {transcriptOnFile ? "Edit" : "Add notes"}
              </button>
              <button
                className="btn-action"
                disabled={savingTranscript || pipelineBusy}
                onClick={() => vttInputRef.current?.click()}
              >
                <Upload size={12} /> Import VTT
              </button>
              <button
                className="btn-action"
                disabled={savingTranscript || pipelineBusy}
                onClick={() => audioInputRef.current?.click()}
              >
                <Upload size={12} /> {audioFile ? "Change audio" : "Choose audio"}
              </button>
            </>
          ) : (
            <>
              <button className="btn-action" onClick={() => setTranscriptEdit(null)}>
                Cancel
              </button>
              <button
                className="btn-action btn-action--primary"
                disabled={savingTranscript}
                onClick={onSaveTranscript}
              >
                <Save size={12} /> {savingTranscript ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </div>

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
            <button className="btn-action" onClick={() => audioInputRef.current?.click()}>
              <Upload size={12} /> {audioFile ? "Change file" : "Choose file"}
            </button>
            <button
              className="btn-action btn-action--primary"
              disabled={!audioFile || pipelineBusy}
              onClick={() => onUploadAudioAndRun(false)}
            >
              <Mic size={12} /> {pipelineBusy ? "Transcribing..." : "Transcribe"}
            </button>
            {!hasMinutes && (
              <button
                className="btn-action"
                disabled={!audioFile || pipelineBusy}
                onClick={() => onUploadAudioAndRun(true)}
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
