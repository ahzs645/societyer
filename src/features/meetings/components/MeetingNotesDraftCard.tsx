/**
 * "AI notes" on the Notes tab: the person's notes plus the transcript become
 * a summary, sections shaped by a template, decisions and open questions
 * (shared/ai/notesDraft.ts). Suggested action items land in the Action items
 * card below. The person's own notes are never changed, except when they
 * choose "Add to my notes".
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Copy, NotebookPen, Play, Quote, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Select } from "@/components/Select";
import { useConfirm } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { formatDateTime } from "@/lib/format";
import {
  NOTES_DRAFT_TEMPLATES,
  notesDraftMarkdown,
  notesDraftTemplate,
  isNotesDraftTemplateId,
  formatClock,
  type NotesDraftQuote,
  type NotesDraftTemplateId,
} from "../../../../shared/ai/notesDraft";
import { notesTranscriptSearch } from "../transcript/transcriptQuote";
import { isDraftCancelled, useDeviceDraftProgress, deviceDraftLabel } from "../deviceDraftProgress";
import { useNotesDraft, type NotesDraftMeeting } from "../useNotesDraft";
import type { Id } from "../../../../convex/_generated/dataModel";
import { NotesDraftSuggestions, SkillRosterDisclosure, type SpeakerSuggestion } from "./NotesDraftSuggestions";
import { DEVICE_AI_SETTINGS_HREF } from "../../../lib/localAi/useDeviceAi";

export type StoredNotesDraft = {
  template: string;
  summary: string;
  sections: { heading: string; points: string[] }[];
  decisions: string[];
  openQuestions: string[];
  quotes?: NotesDraftQuote[];
  generatedAtISO: string;
  generatedBy: string;
  usedNotes: boolean;
  usedTranscript: boolean;
  speakerSuggestions?: SpeakerSuggestion[];
};

export function MeetingNotesDraftCard({
  meeting,
  draft,
  notes,
  transcriptRow,
  hasTranscript,
  canReadTranscript,
  canWrite,
  flushNotes,
  onAddToNotes,
  preferredTemplate,
  onOpenTranscript,
}: {
  meeting: NotesDraftMeeting & { societyId: Id<"societies"> };
  draft: StoredNotesDraft | undefined;
  /** The notes as currently typed. */
  notes: string;
  transcriptRow: unknown;
  hasTranscript: boolean;
  canReadTranscript: boolean;
  canWrite: boolean;
  /** Saves pending note edits first, so the server drafts from what is on screen. */
  flushNotes: () => Promise<unknown>;
  onAddToNotes: (markdown: string) => void;
  /** The template the notes were started from, for the first draft. */
  preferredTemplate?: NotesDraftTemplateId;
  /** The notes surface's Transcript view, where a recording or transcript is added. */
  onOpenTranscript?: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const notesDraft = useNotesDraft(canWrite);
  const discard = usePermissionedMutation(api.meetings.discardNotesDraft, canWrite);
  const progress = useDeviceDraftProgress(meeting._id);
  const [template, setTemplate] = useState<NotesDraftTemplateId>(
    isNotesDraftTemplateId(draft?.template) ? draft!.template : preferredTemplate ?? "general",
  );
  useEffect(() => {
    if (!draft && preferredTemplate) setTemplate(preferredTemplate);
  }, [draft, preferredTemplate]);
  // Follow the stored draft's template (another tab, or a draft saved after this mounted).
  useEffect(() => {
    if (isNotesDraftTemplateId(draft?.template)) setTemplate(draft.template);
  }, [draft?.template]);
  const [running, setRunning] = useState(false);
  // AI notes made from the transcript are only sent to people who may read it.
  const withheld = !draft && Boolean((meeting as { notesDraftWithheld?: boolean }).notesDraftWithheld);
  const hasNotes = notes.trim().length > 0;
  const canDraft = canWrite && !withheld && notesDraft.available && (hasNotes || (hasTranscript && canReadTranscript)) && !running;

  const sourceHint = !canReadTranscript
    ? "Drafts from your notes. Transcripts are only read for people who keep the minutes."
    : hasTranscript
      ? "Drafts from your notes and the transcript."
      : onOpenTranscript
        ? "No transcript yet: drafts from your notes."
        : "No transcript yet: drafts from your notes. Add a recording or transcript on the Transcript tab.";

  const runDraft = async () => {
    if (!canDraft) return;
    if (draft) {
      const ok = await confirm({
        title: "Replace the AI notes?",
        message: "The summary is redrafted. Action items you added, edited or turned into tasks are kept; untouched suggestions are replaced.",
        confirmLabel: "Redraft",
      });
      if (!ok) return;
    }
    setRunning(true);
    try {
      await flushNotes();
      const result = await notesDraft.run({ meeting, template, notes, transcriptRow });
      const added = result?.actionItemsAdded ?? 0;
      toast.success("Notes drafted.", added ? `${added} suggested action item${added === 1 ? "" : "s"} added below.` : undefined);
    } catch (error) {
      if (isDraftCancelled(error)) toast.info("Draft cancelled. Nothing was changed.");
      else toast.error("Could not draft the notes", error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const markdown = draft ? notesDraftMarkdown(draft) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Copied as Markdown.");
    } catch {
      toast.error("Could not copy", "Your browser blocked the clipboard.");
    }
  };

  return (
    <section className="card meeting-ai-notes" aria-labelledby="meeting-ai-notes-title">
      <div className="card__head meeting-ai-notes__head">
        <h2 className="card__title" id="meeting-ai-notes-title">
          <Sparkles size={14} aria-hidden="true" /> AI notes
        </h2>
        {canWrite && !withheld && (
          <div className="meeting-ai-notes__controls">
            <div className="meeting-ai-notes__template">
              <Select
                aria-label="Notes template"
                value={template}
                onChange={(value) => setTemplate(isNotesDraftTemplateId(value) ? value : "general")}
                options={NOTES_DRAFT_TEMPLATES.map((entry) => ({ value: entry.id, label: entry.label, hint: entry.hint }))}
              />
            </div>
            <button type="button" className="btn-action btn-action--primary" onClick={() => { void runDraft(); }} disabled={!canDraft} title={!notesDraft.available ? notesDraft.unavailableReason : undefined}>
              {draft ? <RefreshCw size={12} aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />}
              {running ? (progress ? deviceDraftLabel(progress) : "Drafting…") : draft ? "Redraft" : "Draft notes"}
            </button>
          </div>
        )}
      </div>
      <div className="card__body meeting-ai-notes__body">
        {withheld && (
          <p className="muted">
            This meeting has AI notes. They were made from the transcript, so only people who can read the transcript see them.
          </p>
        )}
        {canWrite && !draft && !withheld && (
          <p className="muted">
            {notesDraftTemplate(template).hint} {sourceHint} Your own notes stay exactly as you wrote them.
            {canReadTranscript && !hasTranscript && onOpenTranscript && (
              <>
                {" "}
                <button type="button" className="text-link meeting-ai-notes__link" onClick={onOpenTranscript}>
                  Add a recording or transcript
                </button>
              </>
            )}
          </p>
        )}
        {canWrite && !withheld && !draft && !notesDraft.available && (
          <p className="flag flag--warn" role="note">
            Drafting notes here uses on-device AI. {notesDraft.unavailableReason}{" "}
            <Link to={DEVICE_AI_SETTINGS_HREF}>Set up on-device AI</Link>
          </p>
        )}
        {canWrite && !withheld && notesDraft.available && !hasNotes && !(hasTranscript && canReadTranscript) && (
          <p className="muted">Write some notes or add a transcript to draft from.</p>
        )}
        {!canWrite && !draft && !withheld && <p className="muted">No AI notes yet.</p>}
        {draft && (
          <NotesDraftView
            draft={draft}
            canWrite={canWrite}
            onAddToNotes={() => onAddToNotes(markdown)}
            onCopy={() => { void copy(); }}
            suggestions={
              <NotesDraftSuggestions
                societyId={meeting.societyId}
                meetingId={meeting._id}
                speakers={draft.speakerSuggestions ?? []}
                transcript={transcriptRow as any}
                canWrite={canWrite}
                canNameSpeakers={canReadTranscript}
              />
            }
            onDiscard={async () => {
              const ok = await confirm({
                title: "Discard the AI notes?",
                message: "The draft and any suggested action items nobody has touched are removed. Your notes and tasks stay.",
                confirmLabel: "Discard",
                tone: "danger",
              });
              if (ok) await discard({ id: meeting._id });
            }}
          />
        )}
        {canWrite && <SkillRosterDisclosure meetingId={meeting._id} />}
      </div>
    </section>
  );
}

function NotesDraftView({
  draft,
  canWrite,
  onAddToNotes,
  onCopy,
  onDiscard,
  suggestions,
}: {
  draft: StoredNotesDraft;
  canWrite: boolean;
  onAddToNotes: () => void;
  onCopy: () => void;
  suggestions?: ReactNode;
  onDiscard: () => Promise<void>;
}) {
  return (
    <article className="meeting-ai-notes__draft" aria-label="AI notes draft">
      {draft.summary && <p className="meeting-ai-notes__summary">{draft.summary}</p>}
      {draft.sections.map((section) => (
        <DraftList key={section.heading} heading={section.heading} items={section.points} />
      ))}
      <DraftList heading="Decisions" items={draft.decisions} />
      <DraftList heading="Open questions" items={draft.openQuestions} />
      <DraftQuotes quotes={draft.quotes ?? []} />
      {suggestions}
      <p className="meeting-ai-notes__meta">
        {notesDraftTemplate(draft.template).label} · drafted {formatDateTime(draft.generatedAtISO)} by {draft.generatedBy}
        {" · from "}
        {[draft.usedNotes ? "your notes" : "", draft.usedTranscript ? "the transcript" : ""].filter(Boolean).join(" and ") || "the meeting"}.
        {" "}Check it before you share it.
      </p>
      <div className="meeting-ai-notes__actions">
        {canWrite && (
          <button type="button" className="btn-action" onClick={onAddToNotes}>
            <NotebookPen size={12} aria-hidden="true" /> Add to my notes
          </button>
        )}
        <button type="button" className="btn-action" onClick={onCopy}>
          <Copy size={12} aria-hidden="true" /> Copy
        </button>
        {canWrite && (
          <button
            type="button"
            className="btn-action"
            onClick={() => { void onDiscard(); }}
          >
            <Trash2 size={12} aria-hidden="true" /> Discard
          </button>
        )}
      </div>
    </article>
  );
}

/** Words kept as said, each with who said it and a link to that moment in the transcript. */
function DraftQuotes({ quotes }: { quotes: readonly NotesDraftQuote[] }) {
  const location = useLocation();
  if (!quotes.length) return null;
  return (
    <section className="meeting-ai-notes__section meeting-ai-notes__quotes" aria-label="Key quotes">
      <h3><Quote size={12} aria-hidden="true" /> Key quotes</h3>
      {quotes.map((quote) => (
        <figure key={quote.text} className="meeting-ai-notes__quote">
          <blockquote>“{quote.text}”</blockquote>
          <figcaption>
            {quote.speaker && <span>— {quote.speaker}</span>}
            {quote.atSec !== undefined && (
              <Link
                className="transcript-time-chip"
                to={{ pathname: location.pathname, search: notesTranscriptSearch(location.search, quote.atSec) }}
                aria-label={`Open the transcript at ${formatClock(quote.atSec)}`}
              >
                <Play size={10} aria-hidden="true" />
                {formatClock(quote.atSec)}
              </Link>
            )}
          </figcaption>
        </figure>
      ))}
    </section>
  );
}

function DraftList({ heading, items }: { heading: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="meeting-ai-notes__section">
      <h3>{heading}</h3>
      <ul>
        {items.map((item, index) => <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>)}
      </ul>
    </section>
  );
}
