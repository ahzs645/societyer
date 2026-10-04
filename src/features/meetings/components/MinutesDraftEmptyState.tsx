import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { useState } from "react";
import { Sparkles, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "../../../components/ui";

/**
 * Rendered above MeetingMinutesColumn when the meeting's minutes record is
 * still an empty skeleton (no user content). Lets the user kick off an AI
 * draft without having to detour through the Sources tab to find the
 * transcript card — either by pasting transcript text inline, by uploading
 * audio, or (when a transcript is already on file) by drafting directly from
 * the saved transcript.
 *
 * Collapsible: defaults closed when the meeting hasn't happened yet (the
 * agenda is still being planned, so transcript/audio tooling is just noise)
 * and open after it's been held. The user can override via the chevron and
 * we remember the choice per meeting in localStorage.
 */
const COLLAPSE_KEY = (meetingId: string) => `societyer.draftMinutes.collapsed.${meetingId}`;

export function MinutesDraftEmptyState({
  meetingId,
  defaultCollapsed,
  transcriptOnFile,
  audioInputRef,
  audioFile,
  busy,
  canDraft,
  canPasteDraft,
  canChooseAudio,
  canUploadDraft,
  onDraftFromPastedText,
  onDraftFromSavedTranscript,
  onUploadAudioAndDraft,
}: {
  meetingId: string;
  defaultCollapsed: boolean;
  transcriptOnFile: string;
  audioInputRef: any;
  audioFile: File | null;
  busy: boolean;
  canDraft: boolean;
  canPasteDraft: boolean;
  canChooseAudio: boolean;
  canUploadDraft: boolean;
  onDraftFromPastedText: (text: string) => Promise<void> | void;
  onDraftFromSavedTranscript: () => Promise<void> | void;
  onUploadAudioAndDraft: () => Promise<void> | void;
}) {
  const remoteAvailable = !isLocalDataRuntime();
  const [pasted, setPasted] = useState("");
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY(meetingId));
      if (stored === "1") return true;
      if (stored === "0") return false;
    } catch {}
    return defaultCollapsed;
  });
  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem(COLLAPSE_KEY(meetingId), next ? "1" : "0"); } catch {}
      return next;
    });
  };
  const hasSavedTranscript = transcriptOnFile.trim().length > 0;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head" style={{ cursor: "pointer" }} onClick={toggle} role="button" aria-expanded={!collapsed}>
        <h2 className="card__title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <Sparkles size={14} /> Draft minutes
        </h2>
        {!collapsed && (
          <span className="card__subtitle">
            {remoteAvailable ? "Paste or upload a transcript to generate a draft you can edit below." : "AI drafting is unavailable in this local workspace. Write minutes manually or save a text transcript from Sources."}
          </span>
        )}
        {hasSavedTranscript && <Badge tone="info">Transcript on file</Badge>}
      </div>
      {collapsed ? null : (
      <div className="card__body col" style={{ gap: 12 }}>
        {!remoteAvailable && <p className="muted" role="status">AI minutes drafting and audio transcription require a connected server. Saved transcripts and manual minutes remain available.</p>}
        {hasSavedTranscript && (
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              {transcriptOnFile.length.toLocaleString()} characters on file.
            </span>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canDraft || busy || !remoteAvailable}
              onClick={() => { if (canDraft) return onDraftFromSavedTranscript(); }}
            >
              <Sparkles size={12} /> {busy ? "Drafting..." : "Draft from saved transcript"}
            </button>
          </div>
        )}

        <div className="col" style={{ gap: 6 }}>
          <label htmlFor="minutes-draft-paste" className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Or paste a transcript here:
          </label>
          <textarea
            id="minutes-draft-paste"
            className="textarea"
            rows={5}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste the meeting transcript or your raw notes — anything in plain text works."
            disabled={!canPasteDraft || busy || !remoteAvailable}
          />
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canPasteDraft || busy || !remoteAvailable || pasted.trim().length === 0}
              onClick={async () => {
                if (!canPasteDraft) return;
                await onDraftFromPastedText(pasted);
                setPasted("");
              }}
            >
              <Sparkles size={12} /> {busy ? "Drafting..." : "Draft from pasted text"}
            </button>
          </div>
        </div>

        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Have a recording instead?
          </span>
          <button
            type="button"
            className="btn"
            disabled={!canChooseAudio || busy || !remoteAvailable}
            onClick={() => { if (canChooseAudio) audioInputRef.current?.click(); }}
          >
            <Upload size={12} /> {audioFile ? `Change audio (${audioFile.name})` : "Choose audio"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canUploadDraft || busy || !remoteAvailable || !audioFile}
            onClick={() => { if (canUploadDraft) return onUploadAudioAndDraft(); }}
          >
            <Sparkles size={12} /> {busy ? "Running..." : "Transcribe & draft"}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
