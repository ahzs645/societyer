/**
 * "Use your own AI": copy a prompt into any AI chat, paste back the JSON it
 * returns, check it and save it as the AI notes. The prompt and the import
 * are shared/ai/meetingNotesManualPrompt.ts; the reply goes through the same
 * checks as the built-in AI's (owners from the People list, quotes word for
 * word from the transcript), and saving re-checks it on the server.
 */
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Check, Copy } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Modal, useConfirm } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import type { Id } from "../../../../convex/_generated/dataModel";
import { notesDraftTranscriptFromRow, type NotesDraftTemplateId } from "../../../../shared/ai/notesDraft";
import type { MeetingNotesSkillContext } from "../../../../shared/ai/meetingNotesSkill";
import {
  buildManualNotesPrompt,
  importManualNotesReply,
  MANUAL_PROMPT_LONG_CHARS,
  MANUAL_PROMPT_SECTIONS,
  manualPromptSectionState,
  type ManualPromptSectionId,
  type ManualReplyImport,
} from "../../../../shared/ai/meetingNotesManualPrompt";

export const MANUAL_DRAFT_GENERATED_BY = "Your own AI (pasted)";

export function ManualNotesDraftDialog({
  open,
  onClose,
  meetingId,
  template,
  notes,
  transcriptRow,
  canReadTranscript,
  hasDraft,
  flushNotes,
}: {
  open: boolean;
  onClose: () => void;
  meetingId: Id<"meetings">;
  template: NotesDraftTemplateId;
  notes: string;
  /** The transcript as this person may read it, in-camera parts already removed. */
  transcriptRow: unknown;
  canReadTranscript: boolean;
  hasDraft: boolean;
  flushNotes: () => Promise<unknown>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const context = useQuery(api.meetings.notesSkillContext, open ? { id: meetingId } : "skip") as MeetingNotesSkillContext | undefined;
  const save = usePermissionedMutation(api.meetings.saveNotesDraft, true);
  const transcript = useMemo(() => (canReadTranscript ? notesDraftTranscriptFromRow(transcriptRow) : ""), [canReadTranscript, transcriptRow]);
  const [sections, setSections] = useState(() => manualPromptSectionState());
  const [requirements, setRequirements] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [showRequirements, setShowRequirements] = useState(false);
  const [saving, setSaving] = useState(false);
  // Checked as it's pasted: the same session as the built-in AI's.
  const checked: ManualReplyImport | null = useMemo(
    () => (context && reply.trim() ? importManualNotesReply(reply, { template, context, transcript }) : null),
    [context, reply, template, transcript],
  );

  const effective = { ...sections, transcript: sections.transcript && Boolean(transcript.trim()) };
  const prompt = useMemo(
    () => (context ? buildManualNotesPrompt({ template, notes, transcript, context, sections: effective, requirements }) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, template, notes, transcript, sections, requirements],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy", "Your browser blocked the clipboard. Open View prompt and copy it from there.");
    }
  };
  const saveDraft = async () => {
    if (!checked?.ok) return;
    if (hasDraft && !(await confirm({ title: "Replace the AI notes?", message: "The summary is replaced. Action items you added, edited or turned into tasks are kept; untouched suggestions are replaced.", confirmLabel: "Replace" }))) return;
    setSaving(true);
    try {
      await flushNotes();
      const { result } = checked;
      const saved = await save({
        id: meetingId,
        template,
        draft: result.draft,
        speakers: result.speakers,
        generatedBy: MANUAL_DRAFT_GENERATED_BY,
        usedNotes: sections.notes && Boolean(notes.trim()),
        // Made from a transcript: the one here, or one attached to the chat instead.
        usedTranscript: Boolean(transcript.trim()) || !sections.transcript,
      }) as { actionItemsAdded?: number } | undefined;
      const added = saved?.actionItemsAdded ?? 0;
      toast.success("AI notes saved.", added ? `${added} suggested action item${added === 1 ? "" : "s"} added.` : undefined);
      setReply("");
      onClose();
    } catch (error) {
      toast.error("Could not save the AI notes", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const transcriptMissing = !transcript.trim();
  return (
    <Modal open={open} onClose={onClose} title="Draft with your own AI" size="md">
      <div className="manual-draft">
        <p className="muted manual-draft__lede">Copy the prompt into ChatGPT, Claude or another AI, then paste its reply below.</p>

        <section className="manual-draft__step" aria-label="Copy the prompt">
          <div className="manual-draft__copy">
            <span className="manual-draft__num" aria-hidden="true">1</span>
            <button type="button" className="btn-action btn-action--primary" onClick={() => { void copy(); }} disabled={!prompt}>
              {copied ? <><Check size={12} aria-hidden="true" /> Copied</> : <><Copy size={12} aria-hidden="true" /> Copy prompt</>}
            </button>
            <span className="muted manual-draft__size">{prompt ? `${Math.round(prompt.length / 1000)}k characters` : "Loading…"}</span>
          </div>
          <div className="manual-draft__chips" role="group" aria-label="Include in the prompt">
            {MANUAL_PROMPT_SECTIONS.map((section) => {
              const unavailable = section.id === "transcript" && transcriptMissing;
              const on = sections[section.id] && !unavailable;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`manual-draft__chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  disabled={unavailable}
                  title={unavailable ? (canReadTranscript ? "No transcript yet: add one in the Transcript view." : "Only people who keep the minutes can include the transcript.") : section.description}
                  onClick={() => setSections((current) => ({ ...current, [section.id]: !current[section.id] }))}
                >
                  {on && <Check size={11} aria-hidden="true" />} {CHIP_LABELS[section.id]}
                </button>
              );
            })}
          </div>
          <div className="manual-draft__links">
            <button type="button" className="manual-draft__link" aria-expanded={showRequirements} onClick={() => setShowRequirements((value) => !value)}>
              {requirements.trim() ? "Edit your instructions" : "Add instructions"}
            </button>
            <button type="button" className="manual-draft__link" aria-expanded={showPrompt} onClick={() => setShowPrompt((value) => !value)}>
              {showPrompt ? "Hide prompt" : "View prompt"}
            </button>
          </div>
          {showRequirements && (
            <textarea
              className="input manual-draft__requirements"
              rows={2}
              value={requirements}
              onChange={(event) => setRequirements(event.target.value)}
              placeholder="Added at the end, e.g. keep the summary to three sentences."
              aria-label="Your instructions for the AI"
            />
          )}
          {prompt.length > MANUAL_PROMPT_LONG_CHARS && (
            <p className="manual-draft__hint">Long prompt: if your AI won't take it in one message, turn off Transcript and attach the transcript file instead.</p>
          )}
          {showPrompt && <pre className="manual-draft__prompt" aria-label="The prompt">{prompt}</pre>}
        </section>

        <section className="manual-draft__step" aria-label="Paste the reply">
          <div className="manual-draft__paste">
            <span className="manual-draft__num" aria-hidden="true">2</span>
            <textarea
              className="input manual-draft__reply"
              rows={6}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Paste the AI's reply here"
              aria-label="The JSON your AI returned"
            />
          </div>
          {checked && !checked.ok && <p className="manual-draft__error" role="alert">{checked.error}</p>}
          {checked?.ok && <ManualReplySummary checked={checked} />}
          <div className="manual-draft__actions">
            <button type="button" className="btn-action btn-action--primary" onClick={() => { void saveDraft(); }} disabled={!checked?.ok || saving}>
              {saving ? "Saving…" : "Save as AI notes"}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

const CHIP_LABELS: Record<ManualPromptSectionId, string> = {
  transcript: "Transcript",
  notes: "My notes",
  people: "People",
  goals: "Goals & committees",
  speakers: "Speaker names",
  quotes: "Quotes",
};

function ManualReplySummary({ checked }: { checked: Extract<ManualReplyImport, { ok: true }> }) {
  const { result } = checked;
  const { draft } = result;
  const owned = draft.actionItems.filter((item) => item.assigneePersonId).length;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const counts = [
    plural(draft.decisions.length, "decision"),
    `${plural(draft.actionItems.length, "action item")}${draft.actionItems.length ? ` (${owned} assigned)` : ""}`,
    ...(draft.openQuestions.length ? [plural(draft.openQuestions.length, "question")] : []),
    ...(draft.quotes?.length ? [plural(draft.quotes.length, "quote")] : []),
  ];
  return (
    <div className="manual-draft__result" role="status">
      <Check size={13} aria-hidden="true" />
      <span>{counts.join(" · ")}</span>
      {result.refused.length > 0 && (
        <details>
          <summary>{result.refused.length} left out</summary>
          <ul>{result.refused.map((item, index) => <li key={index}><code>{item.tool}</code>: {item.reason.replace(/^Not recorded: /, "")}</li>)}</ul>
        </details>
      )}
      {(result.adjusted?.length ?? 0) > 0 && (
        <details>
          <summary>{result.adjusted!.length} link{result.adjusted!.length === 1 ? "" : "s"} dropped</summary>
          <ul>{result.adjusted!.map((item, index) => <li key={index}>{item.reason}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
