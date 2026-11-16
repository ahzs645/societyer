/**
 * Notes beside the team notes: your own (private until you share them) and
 * notes others have shared. Handlers: shared/functions/meetingPersonalNotes.ts.
 *
 * The notes card's title is a switcher: Team notes, then My notes once you've
 * added them, then each person who shared theirs. With nothing else to show
 * it's just "Team notes" and a "My notes" button.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { FileText, Plus, Trash2, Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Select } from "@/components/Select";
import { Toggle } from "@/components/Controls";
import { useConfirm } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/format";
import { createNotesAutosave, type NotesSaveState } from "../lib/notesAutosave";
import type { PersonalNotes } from "../../../../shared/functions/meetingPersonalNotes";

export type NotesDocId = "team" | "mine" | `shared:${string}`;

const SAVE_LABELS: Record<NotesSaveState, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  error: "Not saved. Your changes are still here.",
};

export function NotesDocSwitcher({
  doc,
  onDoc,
  mine,
  others,
  onAddMine,
  adding,
}: {
  doc: NotesDocId;
  onDoc: (doc: NotesDocId) => void;
  mine: PersonalNotes | null | undefined;
  others: readonly PersonalNotes[];
  /** Absent when the person can't keep notes here. */
  onAddMine?: () => void;
  adding?: boolean;
}) {
  const options = [
    { value: "team", label: "Team notes", hint: "Everyone who can edit the meeting" },
    ...(mine ? [{ value: "mine", label: "My notes", hint: mine.shared ? "Shared with the team" : "Only you" }] : []),
    ...others.map((row) => ({ value: `shared:${row._id}`, label: `${row.authorName}'s notes`, hint: "Shared" })),
  ];
  return (
    <div className="notes-doc-switch">
      <FileText size={14} aria-hidden="true" />
      {options.length > 1 ? (
        <div className="notes-doc-switch__select">
          <Select aria-label="Which notes" value={doc} onChange={(value) => onDoc(value as NotesDocId)} options={options} />
        </div>
      ) : (
        <h2 className="card__title">Team notes</h2>
      )}
      {!mine && onAddMine && (
        <button type="button" className="btn-action notes-doc-switch__add" onClick={onAddMine} disabled={adding} title="Private notes only you can see, unless you share them">
          <Plus size={12} aria-hidden="true" /> My notes
        </button>
      )}
    </div>
  );
}

/** Your own notes: autosaved, private until you share them. */
export function MyNotesCard({ meetingId, row, title, onDeleted }: { meetingId: string; row: PersonalNotes; title: ReactNode; onDeleted: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const save = useMutation(api.meetingPersonalNotes.save);
  const setShared = useMutation(api.meetingPersonalNotes.setShared);
  const remove = useMutation(api.meetingPersonalNotes.remove);
  const controller = useMemo(
    () => createNotesAutosave(row.body, (body, expected) => save({ meetingId, body, expected })),
    // A newer server copy is reconciled below, never a new editing session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meetingId, row._id, save],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.receiveServer(row.body); }, [controller, row.body]);
  const timer = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    void controller.flush().catch(() => undefined);
  }, [controller]);
  useEffect(() => () => flush(), [flush]);
  const onChange = (next: string) => {
    controller.change(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 800);
  };

  const toggleShared = async (shared: boolean) => {
    try {
      flush();
      await setShared({ meetingId, shared });
      toast.success(shared ? "Your notes are shared with the team." : "Your notes are private again.");
    } catch (error) {
      toast.error("Could not change sharing", error instanceof Error ? error.message : String(error));
    }
  };
  const deleteNotes = async () => {
    if (!(await confirm({ title: "Delete your notes?", message: "Your notes on this meeting are deleted. The team notes stay.", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await remove({ meetingId });
      onDeleted();
    } catch (error) {
      toast.error("Could not delete your notes", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="card meeting-notes-doc" aria-label="My notes">
      <div className="card__head meeting-notes-doc__head">
        {title}
        <span className={`meeting-notes-doc__status is-${state.saveState}`} role="status" aria-live="polite">{SAVE_LABELS[state.saveState]}</span>
      </div>
      <div className="card__body meeting-notes-doc__body" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) flush(); }}>
        <MarkdownEditor value={state.value} onChange={onChange} rows={10} aria-label="My notes" placeholder="Your own notes: only you see them unless you share them." />
        {state.saveState === "error" && <p className="flag flag--warn" role="alert">{state.error || "Your notes could not be saved."} They're still in the editor.</p>}
        <div className="personal-notes__footer">
          <Toggle
            size="sm"
            checked={row.shared}
            onChange={(next) => { void toggleShared(next); }}
            label={row.shared ? "Shared with the team" : "Only you"}
            hint={row.shared ? "Everyone who can read this meeting sees them, and the AI notes use them." : "Share them so the team can read them and the AI notes can use them."}
          />
          <button type="button" className="btn-action" onClick={() => { void deleteNotes(); }}>
            <Trash2 size={12} aria-hidden="true" /> Delete my notes
          </button>
        </div>
      </div>
    </section>
  );
}

/** Someone else's shared notes: read only. */
export function SharedNotesCard({ row, title }: { row: PersonalNotes; title: ReactNode }) {
  return (
    <section className="card meeting-notes-doc" aria-label={`${row.authorName}'s notes`}>
      <div className="card__head meeting-notes-doc__head">
        {title}
        <span className="meeting-notes-doc__status muted"><Users size={12} aria-hidden="true" /> Shared · updated {formatDateTime(row.updatedAtISO)}</span>
      </div>
      <div className="card__body meeting-notes-doc__body">
        <MarkdownEditor value={row.body} onChange={() => undefined} readOnly rows={8} aria-label={`${row.authorName}'s notes`} />
      </div>
    </section>
  );
}
