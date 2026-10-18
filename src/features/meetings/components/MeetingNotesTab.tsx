/**
 * The Notes tab for a meeting that keeps informal notes (`recordKind:
 * "notes"`): one calm document that autosaves into `meetings.workingNotes`,
 * the progress stepper, and "Turn notes into minutes".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { useConfirm } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { MEETING_WORKING_NOTES_MAX_LENGTH, type MeetingRecordStep } from "../../../../shared/meetingRecordKind";
import { MeetingRecordStepper } from "./MeetingRecordStepper";

/** Typing must pause this long before the notes save. */
const NOTES_SAVE_DELAY_MS = 800;

type SaveState = "saved" | "pending" | "saving" | "error";

const SAVE_STATE_LABELS: Record<SaveState, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  error: "Not saved. Retrying when you type again.",
};

/**
 * Local copy of the notes with a debounced save. Typing waits for a pause,
 * blur, page hide or unmount, then saves once. Newer server text replaces the
 * local copy only while nothing is waiting to save.
 */
function useAutosavedNotes(meetingId: Id<"meetings">, serverValue: string, canWrite: boolean) {
  const update = usePermissionedMutation(api.meetings.update, canWrite);
  const [value, setValue] = useState(serverValue);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const queued = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const lastSaved = useRef(serverValue);
  const inFlight = useRef<Promise<void> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = queued.current;
    if (next === null) {
      await inFlight.current;
      return;
    }
    queued.current = null;
    if (next === lastSaved.current) {
      setSaveState("saved");
      return;
    }
    setSaveState("saving");
    const run = (async () => {
      try {
        await update({ id: meetingId, patch: { workingNotes: next } });
        lastSaved.current = next;
        setSaveState(queued.current === null ? "saved" : "pending");
      } catch {
        queued.current = queued.current ?? next;
        setSaveState("error");
      }
    })();
    inFlight.current = run;
    await run;
  }, [meetingId, update]);

  useEffect(() => {
    if (queued.current !== null || serverValue === lastSaved.current) return;
    lastSaved.current = serverValue;
    setValue(serverValue);
  }, [serverValue]);

  useEffect(() => {
    const onPageHide = () => { void flush(); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void flush();
    };
  }, [flush]);

  const onChange = (next: string) => {
    if (!canWrite) return;
    setValue(next);
    queued.current = next;
    setSaveState("pending");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, NOTES_SAVE_DELAY_MS);
  };

  return { value, onChange, flush, saveState };
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
  const notes = useAutosavedNotes(meetingId, workingNotes ?? "", canWrite);
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
        <div className="card__body meeting-notes-doc__body" onBlur={() => { void notes.flush(); }}>
          <MarkdownEditor
            value={notes.value}
            onChange={notes.onChange}
            readOnly={!canWrite}
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
          {!canWrite && <p className="muted">You can read these notes. Editing needs meeting edit access.</p>}
        </div>
      </section>
      {canStartMinutes && (
        <div className="meeting-notes-tab__actions">
          <button type="button" className="btn btn--accent" onClick={() => { void turnIntoMinutes(); }} disabled={converting}>
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
