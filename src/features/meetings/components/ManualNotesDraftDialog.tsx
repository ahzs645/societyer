/**
 * "Use your own AI": copy a prompt into any AI chat, paste back the JSON it
 * returns, check it and save it as the AI notes. The prompt and the import
 * are shared/ai/meetingNotesManualPrompt.ts; the reply goes through the same
 * checks as the built-in AI's (owners from the People list, quotes word for
 * word from the transcript), and saving re-checks it on the server.
 */
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Check, ChevronDown, ClipboardPaste, Copy } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Modal, useConfirm } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import type { Id } from "../../../../convex/_generated/dataModel";
import { notesDraftTemplate, notesDraftTranscriptFromRow, type NotesDraftTemplateId } from "../../../../shared/ai/notesDraft";
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

const CORE_SECTIONS: ManualPromptSectionId[] = ["transcript", "notes", "people"];
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
  const [checked, setChecked] = useState<ManualReplyImport | null>(null);
  const [saving, setSaving] = useState(false);

  const effective = { ...sections, transcript: sections.transcript && Boolean(transcript.trim()) };
  const prompt = useMemo(
    () => (context ? buildManualNotesPrompt({ template, notes, transcript, context, sections: effective, requirements }) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, template, notes, transcript, sections, requirements],
  );
  const enabled = MANUAL_PROMPT_SECTIONS.filter((section) => sections[section.id]).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy", "Your browser blocked the clipboard. Open View prompt and copy it from there.");
    }
  };
  const check = () => {
    if (!context) return;
    setChecked(importManualNotesReply(reply, { template, context, transcript }));
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
      setChecked(null);
      onClose();
    } catch (error) {
      toast.error("Could not save the AI notes", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Draft the AI notes with your own AI" size="lg">
      <div className="manual-draft">
        <section className="manual-draft__step" aria-labelledby="manual-draft-copy">
          <div className="manual-draft__step-head">
            <h3 id="manual-draft-copy">1. Copy the prompt</h3>
            <button type="button" className="btn-action btn-action--primary" onClick={() => { void copy(); }} disabled={!prompt}>
              {copied ? <><Check size={12} aria-hidden="true" /> Copied</> : <><Copy size={12} aria-hidden="true" /> Copy prompt</>}
            </button>
          </div>
          <p className="muted">
            Paste it into your AI (ChatGPT, Claude, Copilot or another), then bring back the JSON it returns. It asks for the {notesDraftTemplate(template).label} template;
            change the template on the AI notes card. It includes {transcript.trim() ? "the transcript" : "no transcript"}{context ? ` and ${context.people.length} ${context.people.length === 1 ? "person" : "people"} the AI can assign work to` : ""}.
          </p>
          {!context && <p className="muted" role="status">Loading the people, goals and committees…</p>}
          <div className="manual-draft__blocks">
            <div className="manual-draft__blocks-head">
              <span className="muted">Choose what goes in the prompt.</span>
              <span className="manual-draft__presets">
                <button type="button" className="btn-action" onClick={() => setSections(manualPromptSectionState())}>Everything</button>
                <button type="button" className="btn-action" onClick={() => setSections(manualPromptSectionState(CORE_SECTIONS))}>Core only</button>
              </span>
            </div>
            <div className="manual-draft__grid">
              {MANUAL_PROMPT_SECTIONS.map((section) => {
                const unavailable = section.id === "transcript" && !transcript.trim();
                return (
                  <label key={section.id} className={`manual-draft__block${unavailable ? " is-disabled" : ""}`}>
                    <input
                      type="checkbox"
                      checked={sections[section.id] && !unavailable}
                      disabled={unavailable}
                      onChange={() => setSections((current) => ({ ...current, [section.id]: !current[section.id] }))}
                    />
                    <span>
                      <strong>{section.label}</strong>
                      <span className="muted">{unavailable ? (canReadTranscript ? "No transcript yet. Add one in the Transcript view." : "Only people who keep the minutes can include the transcript.") : section.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="muted">{enabled} of {MANUAL_PROMPT_SECTIONS.length} blocks included.</p>
          </div>
          <label className="manual-draft__requirements">
            <span>Anything else for the AI (added at the end)</span>
            <textarea className="input" rows={2} value={requirements} onChange={(event) => setRequirements(event.target.value)} placeholder="For example: keep the summary to three sentences; list every date mentioned." />
          </label>
          {prompt.length > MANUAL_PROMPT_LONG_CHARS && (
            <p className="flag flag--warn">This prompt is {Math.round(prompt.length / 1000)}k characters. If your AI won't take it in one message, untick Transcript and attach the transcript file to the chat instead.</p>
          )}
          <button type="button" className="btn-action manual-draft__toggle" aria-expanded={showPrompt} onClick={() => setShowPrompt((value) => !value)}>
            <ChevronDown size={12} aria-hidden="true" style={{ transform: showPrompt ? "rotate(180deg)" : undefined }} /> {showPrompt ? "Hide prompt" : "View prompt"} ({Math.round(prompt.length / 1000)}k characters)
          </button>
          {showPrompt && <pre className="manual-draft__prompt" aria-label="The prompt">{prompt}</pre>}
        </section>

        <section className="manual-draft__step" aria-labelledby="manual-draft-paste">
          <h3 id="manual-draft-paste">2. Paste what it returns</h3>
          <textarea
            className="input manual-draft__reply"
            rows={8}
            value={reply}
            onChange={(event) => { setReply(event.target.value); setChecked(null); }}
            placeholder='{"calls": [{"tool": "write_summary", "arguments": {…}}, …]}'
            aria-label="The JSON your AI returned"
          />
          <div className="manual-draft__actions">
            <button type="button" className="btn-action" onClick={check} disabled={!reply.trim() || !context}>
              <ClipboardPaste size={12} aria-hidden="true" /> Check
            </button>
            <button type="button" className="btn-action btn-action--primary" onClick={() => { void saveDraft(); }} disabled={!checked?.ok || saving}>
              {saving ? "Saving…" : "Save as AI notes"}
            </button>
          </div>
          {checked && !checked.ok && <p className="flag flag--warn" role="alert">{checked.error}</p>}
          {checked?.ok && <ManualReplySummary checked={checked} />}
        </section>
      </div>
    </Modal>
  );
}

function ManualReplySummary({ checked }: { checked: Extract<ManualReplyImport, { ok: true }> }) {
  const { result } = checked;
  const { draft } = result;
  const owned = draft.actionItems.filter((item) => item.assigneePersonId).length;
  const counts = [
    `${draft.sections.length} section${draft.sections.length === 1 ? "" : "s"}`,
    `${draft.decisions.length} decision${draft.decisions.length === 1 ? "" : "s"}`,
    `${draft.actionItems.length} action item${draft.actionItems.length === 1 ? "" : "s"}${draft.actionItems.length ? ` (${owned} with an owner from People)` : ""}`,
    `${draft.openQuestions.length} open question${draft.openQuestions.length === 1 ? "" : "s"}`,
    ...(draft.quotes?.length ? [`${draft.quotes.length} quote${draft.quotes.length === 1 ? "" : "s"}`] : []),
    ...(result.speakers.length ? [`${result.speakers.length} speaker${result.speakers.length === 1 ? "" : "s"} named`] : []),
  ];
  return (
    <div className="manual-draft__result" role="status">
      <p><strong>Ready to save:</strong> {counts.join(", ")}.</p>
      {draft.summary && <p className="muted">{draft.summary}</p>}
      {result.refused.length > 0 && (
        <details>
          <summary>{result.refused.length} call{result.refused.length === 1 ? " was" : "s were"} left out</summary>
          <ul>{result.refused.map((item, index) => <li key={index}><code>{item.tool}</code>: {item.reason.replace(/^Not recorded: /, "")}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
