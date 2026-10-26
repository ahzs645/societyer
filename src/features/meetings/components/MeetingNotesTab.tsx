/**
 * The Notes tab for a meeting that keeps informal notes (`recordKind:
 * "notes"`): one calm document that autosaves into `meetings.workingNotes`,
 * the progress stepper, and "Turn notes into minutes".
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FileText } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { useConfirm } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { MEETING_WORKING_NOTES_MAX_LENGTH, type MeetingRecordStep } from "../../../../shared/meetingRecordKind";
import { MeetingRecordStepper } from "./MeetingRecordStepper";
import { MeetingDraftRecovery, useMeetingDraft } from "../useMeetingDraft";
import type { AutosaveDraft } from "../lib/meetingDraftStore";
import { createNotesAutosave, type NotesSaveState } from "../lib/notesAutosave";

/** Typing must pause this long before the notes save. */
const NOTES_SAVE_DELAY_MS = 800;

const SAVE_STATE_LABELS: Record<NotesSaveState, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  error: "Not saved. Your changes are still here.",
};

/**
 * Local copy of the notes with a debounced save. Typing waits for a pause,
 * blur, page hide or unmount, then saves once. Newer server text replaces the
 * local copy only while nothing is waiting to save.
 */
function useAutosavedNotes(meetingId: Id<"meetings">, serverValue: string | undefined, canWrite: boolean) {
  const update = usePermissionedMutation(api.meetings.update, canWrite);
  const recovery = useMeetingDraft<AutosaveDraft<string, string | null>>("notes", (value): value is AutosaveDraft<string, string | null> => {
    const row = value as AutosaveDraft<string, string | null> | null;
    return !!row && typeof row.value === "string" && (typeof row.baseline === "string" || row.baseline === null);
  });
  const controller = useMemo(() => createNotesAutosave(serverValue, (workingNotes, expected) =>
    update({ id: meetingId, patch: { workingNotes }, expected: { workingNotes: expected } }), recovery.journal ?? undefined,
    // A changed server value is reconciled below, never a new edit session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [meetingId, update, recovery.journal]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const timer = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    return controller.flush();
  }, [controller]);
  // Autosave events surface failure inline. Explicit workflows await flush and
  // must stop on rejection (notably turning the notes into formal minutes).
  const flushInBackground = useCallback(() => { void flush().catch(() => undefined); }, [flush]);

  useEffect(() => { controller.receiveServer(serverValue); }, [controller, serverValue]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (controller.getSnapshot().saveState === "saved") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", flushInBackground);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("pagehide", flushInBackground);
      window.removeEventListener("beforeunload", beforeUnload);
      flushInBackground();
    };
  }, [controller, flushInBackground]);

  const onChange = (next: string) => {
    if (!canWrite) return;
    controller.change(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flushInBackground, NOTES_SAVE_DELAY_MS);
  };
  return { ...state, onChange, flush, flushInBackground, useLatestServer: controller.useLatestServer, recovery, restore: controller.restore, saveRecovered: controller.saveRecovered };
}

export function MeetingNotesTab({
  meetingId,
  workingNotes,
  canWrite,
  canStartMinutes,
  minutesApproved,
  steps,
  onMinutesStarted,
}: {
  meetingId: Id<"meetings">;
  workingNotes: string | undefined;
  /** meetings:write: edit the notes. */
  canWrite: boolean;
  /** meetings:write and minutes:write: turn the notes into minutes. */
  canStartMinutes: boolean;
  minutesApproved: boolean;
  steps: MeetingRecordStep[];
  onMinutesStarted: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const startMinutesFromNotes = usePermissionedMutation(api.meetings.startMinutesFromNotes, canStartMinutes);
  const notes = useAutosavedNotes(meetingId, workingNotes, canWrite);
  const [converting, setConverting] = useState(false);
  const tooLong = notes.value.length > MEETING_WORKING_NOTES_MAX_LENGTH;

  const turnIntoMinutes = async () => {
    if (!canStartMinutes || converting) return;
    const ok = await confirm({
      title: "Turn notes into minutes?",
      message: minutesApproved
        ? "This meeting will keep formal minutes. Its minutes are already approved, so they stay exactly as they are. Your notes stay on file."
        : "This meeting will keep formal minutes: agenda, motions, quorum and approval. Your notes are copied into the minutes draft and stay on file.",
      confirmLabel: "Turn into minutes",
    });
    if (!ok) return;
    setConverting(true);
    try {
      await notes.flush();
      const result = await startMinutesFromNotes({ id: meetingId });
      const motions = result?.motionsSeeded
        ? `${result.motionsSeeded} recurring motion${result.motionsSeeded === 1 ? " was" : "s were"} added from the template.`
        : undefined;
      if (result?.approved) toast.info("Approved minutes were left unchanged.");
      else if (result?.seeded) toast.success("Minutes draft started from your notes.", motions);
      else toast.success("This meeting now keeps formal minutes.", motions);
      onMinutesStarted();
    } catch (error) {
      toast.error("Could not start the minutes", error instanceof Error ? error.message : String(error));
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="meeting-notes-tab">
      <MeetingRecordStepper steps={steps} />
      <section className="card meeting-notes-doc" aria-labelledby="meeting-notes-doc-title">
        <div className="card__head meeting-notes-doc__head">
          <h2 className="card__title" id="meeting-notes-doc-title">
            <FileText size={14} aria-hidden="true" /> Meeting notes
          </h2>
          {canWrite && (
            <span className={`meeting-notes-doc__status is-${notes.saveState}`} role="status" aria-live="polite">
              {SAVE_STATE_LABELS[notes.saveState]}
            </span>
          )}
        </div>
        <div className="card__body meeting-notes-doc__body" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) notes.flushInBackground();
        }}>
          <MeetingDraftRecovery draft={notes.recovery} label="notes" onRestore={notes.restore} disabled={!canWrite || notes.saveState !== "saved"} />
          {notes.recovered && <div className="flag flag--warn" role="status">
            <p>Recovered notes are ready to review. Saving uses their original server version, so newer work by someone else will cause a conflict.</p>
            <button type="button" className="btn-action" disabled={!canWrite} onClick={() => { void notes.saveRecovered().catch(() => undefined); }}>Save recovered draft</button>
            <button type="button" className="btn-action" onClick={notes.useLatestServer}>Discard restored notes</button>
          </div>}
          <MarkdownEditor
            value={notes.value}
            onChange={notes.onChange}
            readOnly={!canWrite || converting}
            rows={14}
            aria-label="Meeting notes"
            placeholder="Who came, what was discussed, what was decided, who is following up."
            aria-invalid={tooLong || undefined}
          />
          {tooLong && (
            <p className="flag flag--warn" role="alert">
              These notes are too long to save. Move long material into a document or the transcript.
            </p>
          )}
          {notes.saveState === "error" && (
            <div className="flag flag--warn" role="alert">
              <p>{notes.error || "The notes could not be saved."} Your draft is still in the editor.</p>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn-action" onClick={notes.flushInBackground} disabled={!canWrite}>Retry save</button>
                <button type="button" className="btn-action" onClick={async () => {
                  const discard = await confirm({
                    title: "Load the latest saved notes?",
                    message: "This replaces your unsaved draft with the latest saved notes. Copy any text you want to keep before continuing.",
                    confirmLabel: "Load saved notes",
                    tone: "warn",
                  });
                  if (discard) notes.useLatestServer();
                }}>Load saved notes</button>
              </div>
            </div>
          )}
          {!canWrite && <p className="muted">You can read these notes. Editing needs meeting edit access.</p>}
        </div>
      </section>
      {canStartMinutes && (
        <div className="meeting-notes-tab__actions">
          <button type="button" className="btn btn--accent" onClick={() => { void turnIntoMinutes(); }} disabled={converting || tooLong}>
            {converting ? "Starting minutes…" : "Turn notes into minutes"}
          </button>
          <span className="meeting-notes-tab__actions-hint">
            Adds the agenda, motions, quorum and approval. Your notes start the draft.
          </span>
        </div>
      )}
    </div>
  );
}
