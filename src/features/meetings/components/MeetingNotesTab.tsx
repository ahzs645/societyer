/**
 * The Notes and Transcript tabs for a meeting that keeps informal notes
 * (`recordKind: "notes"`): one calm document that autosaves into
 * `meetings.workingNotes`, and "Turn notes into minutes". Both tabs are this
 * one surface so the transcript can quote into the notes and opened views
 * stay mounted.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { EditorSaveStatus } from "@/components/EditorSaveStatus";
import { MentionPeopleContext, type MentionPerson } from "@/components/MarkdownMentions";
import { useConfirm } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { MEETING_WORKING_NOTES_MAX_LENGTH } from "../../../../shared/meetingRecordKind";
import { MeetingDraftRecovery, useMeetingDraft } from "../useMeetingDraft";
import type { AutosaveDraft } from "../lib/meetingDraftStore";
import { createNotesAutosave } from "../lib/notesAutosave";
import { MeetingNotesDraftCard, type StoredNotesDraft } from "./MeetingNotesDraftCard";
import { MeetingNoteActionsCard } from "./MeetingNoteActionsCard";
import type { NotesDraftMeeting } from "../useNotesDraft";
import type { NoteActionItem } from "../../../../shared/meetingNoteActions";
import type { DirectoryPerson } from "../../../components/PersonNameLinkField";
import { isNotesView, MeetingAskBar, NotesMoreMenu, NotesSurfaceBar, NotesTemplateStarter, RecordControl, templateHeadings, type NotesView } from "./NotesSurface";
import { useMeetingRecorder } from "../recorder/meetingRecorder";
import { notesDraftTranscriptFromRow, type NotesDraftTemplateId } from "../../../../shared/ai/notesDraft";
import type { NotesExportInput } from "../../../../shared/meetingNotesExport";
import { notesTranscriptLink, transcriptQuoteMarkdown, TranscriptQuoteContext, type TranscriptQuotePick } from "../transcript/transcriptQuote";
import { useMutation, useQuery } from "convex/react";
import { MyNotesCard, NotesDocSwitcher, SharedNotesCard, type NotesDocId } from "./PersonalNotesCards";
import { sharedNotesForDraft, type PersonalNotes } from "../../../../shared/functions/meetingPersonalNotes";

/** Typing must pause this long before the notes save. */
const NOTES_SAVE_DELAY_MS = 800;

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
  return { ...state, onChange, flush, flushInBackground, useLatestServer: controller.useLatestServer, keepBoth: controller.keepBoth, recovery, restore: controller.restore, saveRecovered: controller.saveRecovered };
}

export function MeetingNotesTab({
  meetingId,
  workingNotes,
  canWrite,
  canStartMinutes,
  minutesApproved,
  onMinutesStarted,
  meeting,
  transcriptRow,
  hasTranscript,
  canReadTranscript,
  canCreateTasks,
  people,
  committees,
  tasks,
  transcriptView,
  section,
  onSection,
  phone = false,
  onOpenDetails,
}: {
  meetingId: Id<"meetings">;
  /** Which meeting tab is open: Notes, or the Transcript tab. */
  section: "notes" | "transcript";
  /** Opens the other tab; `view` also picks what the Notes tab shows. */
  onSection: (section: "notes" | "transcript", view?: NotesView) => unknown;
  /** The Transcript view: the transcript workspace, or why it can't be read. */
  transcriptView?: ReactNode;
  phone?: boolean;
  /** Phone: the ••• menu's "Meeting details" (the Overview tab). */
  onOpenDetails?: () => void;
  workingNotes: string | undefined;
  /** The meeting row: AI notes draft and action items live on it. */
  meeting: NotesDraftMeeting & { societyId: Id<"societies">; notesDraft?: StoredNotesDraft; noteActionItems?: NoteActionItem[]; location?: string; remoteUrl?: string };
  /** The working transcript as this person may read it (undefined while loading or not readable). */
  transcriptRow: unknown;
  hasTranscript: boolean;
  canReadTranscript: boolean;
  canCreateTasks: boolean;
  people?: DirectoryPerson[];
  committees?: ReadonlyArray<{ _id: string; name: string }>;
  tasks?: ReadonlyArray<{ _id: string; title: string; status: string }>;
  /** meetings:write: edit the notes. */
  canWrite: boolean;
  /** meetings:write and minutes:write: turn the notes into minutes. */
  canStartMinutes: boolean;
  minutesApproved: boolean;
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

  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const recorder = useMeetingRecorder();
  const recordingHere = recorder.meetingId === meetingId && (recorder.phase === "recording" || recorder.phase === "starting");
  const requested = searchParams.get("view");
  // While recording you write notes; afterwards the AI notes come first once drafted.
  // Chosen once when the tab opens, so a draft arriving never pulls you away from your notes.
  const [fallbackView] = useState<NotesView>(() => (recordingHere ? "notes" : meeting.notesDraft ? "ai" : "notes"));
  const notesView: NotesView = isNotesView(requested) ? requested : fallbackView;
  const view: NotesView | "transcript" = section === "transcript" ? "transcript" : notesView;
  /** Shows `next` in the Notes tab, leaving the Transcript tab if that's open. */
  const setView = (next: NotesView) => {
    if (section === "transcript") {
      void onSection("notes", next);
      return;
    }
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set("view", next);
      return params;
    }, { replace: true });
  };
  // Views stay mounted once opened (the editor's undo, a loaded recording); hidden ones pause their media.
  const [visited, setVisited] = useState<ReadonlySet<NotesView | "transcript">>(() => new Set([view]));
  useEffect(() => setVisited((current) => (current.has(view) ? current : new Set([...current, view]))), [view]);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    surface.current?.querySelectorAll<HTMLMediaElement>(".notes-surface__view[hidden] audio, .notes-surface__view[hidden] video").forEach((media) => media.pause());
  }, [view]);
  const [preferredTemplate, setPreferredTemplate] = useState<NotesDraftTemplateId | undefined>();
  // "@" in the notes mentions people from the directory (a link to their profile).
  const mentionPeople = useMemo<MentionPerson[]>(
    () => (people ?? []).filter((person) => person.fullName).map((person) => ({ id: String(person._id), name: person.fullName })),
    [people],
  );
  const actionItems = meeting.noteActionItems ?? [];

  // Team notes, plus your own (once you add them) and notes others shared.
  const myNotes = useQuery(api.meetingPersonalNotes.mine, { meetingId }) as PersonalNotes | null | undefined;
  const sharedNotes = useQuery(api.meetingPersonalNotes.shared, { meetingId }) as PersonalNotes[] | undefined;
  const addMine = useMutation(api.meetingPersonalNotes.save);
  const [doc, setDoc] = useState<NotesDocId>("team");
  const [addingMine, setAddingMine] = useState(false);
  const othersShared = useMemo(() => (sharedNotes ?? []).filter((row) => !row.mine), [sharedNotes]);
  const shownShared = doc.startsWith("shared:") ? othersShared.find((row) => `shared:${row._id}` === doc) : undefined;
  const shownDoc: NotesDocId = doc === "mine" ? (myNotes ? "mine" : "team") : doc.startsWith("shared:") ? (shownShared ? doc : "team") : "team";
  // What the AI reads: the team notes and every shared person's notes; private notes never.
  const notesForAi = useMemo(() => sharedNotesForDraft(notes.value, sharedNotes ?? []), [notes.value, sharedNotes]);
  const startMine = async () => {
    setAddingMine(true);
    try {
      await addMine({ meetingId, body: "", expected: null });
      setDoc("mine");
    } catch (error) {
      toast.error("Could not add your notes", error instanceof Error ? error.message : String(error));
    } finally {
      setAddingMine(false);
    }
  };
  const switcher = (
    <NotesDocSwitcher
      doc={shownDoc}
      onDoc={setDoc}
      view={notesView}
      onView={setView}
      mine={myNotes}
      others={othersShared}
      hasDraft={Boolean(meeting.notesDraft)}
      actionCount={actionItems.filter((item) => !item.done && item.status !== "cancelled").length}
      onAddMine={myNotes === null ? () => { void startMine(); } : undefined}
      adding={addingMine}
    />
  );

  const exportInput = (): NotesExportInput => ({
    meeting: { title: meeting.title, scheduledAt: meeting.scheduledAt, location: meeting.location, attendeeIds: meeting.attendeeIds },
    notes: notesForAi,
    draft: meeting.notesDraft ?? null,
    actionItems,
    transcript: notesDraftTranscriptFromRow(transcriptRow),
  });

  // Quote in notes: the selection goes under the notes as a quote linked back to that moment.
  const quoteInNotes = canWrite && !converting
    ? (quote: TranscriptQuotePick) => {
        notes.onChange(appendMarkdown(notes.value, transcriptQuoteMarkdown(quote, notesTranscriptLink(quote.start, quote.end, location))));
        toast.success("Quoted in the team notes.", { action: { label: "Show notes", onClick: () => { setDoc("team"); setView("notes"); } } });
      }
    : null;

  const actionsCard = (
    <MeetingNoteActionsCard
      societyId={meeting.societyId}
      meetingId={meetingId}
      items={actionItems}
      people={people}
      committees={committees}
      tasks={tasks}
      canWrite={canWrite && !converting}
      canCreateTasks={canCreateTasks}
    />
  );

  return (
    <MentionPeopleContext.Provider value={mentionPeople}>
    <div className="meeting-notes-tab notes-surface" ref={surface}>
      <NotesSurfaceBar
        switcher={section === "transcript" ? undefined : switcher}
        record={<RecordControl meetingId={meetingId} meetingTitle={meeting.title} joinUrl={meeting.remoteUrl} canWrite={canWrite} onStarted={() => setView("notes")} compact={phone} />}
        more={<NotesMoreMenu exportInput={exportInput} onOpenDetails={phone ? onOpenDetails : undefined} />}
      />
      <div className="notes-surface__view" hidden={view !== "notes"}>
        {shownDoc === "mine" && myNotes && <MyNotesCard key={myNotes._id} meetingId={meetingId} row={myNotes} onDeleted={() => setDoc("team")} />}
        {shownShared && <SharedNotesCard row={shownShared} />}
        <div hidden={shownDoc !== "team"}>
        <NotesDocCard
          notes={notes}
          canWrite={canWrite}
          converting={converting}
          tooLong={tooLong}
          onPickTemplate={(template) => {
            notes.onChange(templateHeadings(template));
            setPreferredTemplate(template);
          }}
        />
        </div>
      </div>
      {visited.has("ai") && (
        <div className="notes-surface__view" hidden={view !== "ai"}>
          <MeetingNotesDraftCard
            meeting={meeting}
            draft={meeting.notesDraft}
            notes={notesForAi}
            transcriptRow={transcriptRow}
            hasTranscript={hasTranscript}
            canReadTranscript={canReadTranscript}
            canWrite={canWrite && !converting}
            flushNotes={notes.flush}
            preferredTemplate={preferredTemplate}
            onOpenTranscript={() => { void onSection("transcript"); }}
            onAddToNotes={(markdown) => { notes.onChange(appendMarkdown(notes.value, markdown)); toast.success("Added to the team notes."); }}
          />
        </div>
      )}
      {visited.has("transcript") && (
        <div className="notes-surface__view notes-surface__view--transcript" hidden={view !== "transcript"}>
          <TranscriptQuoteContext.Provider value={quoteInNotes}>{transcriptView}</TranscriptQuoteContext.Provider>
        </div>
      )}
      {phone ? (
        visited.has("actions") && <div className="notes-surface__view" hidden={view !== "actions"}>{actionsCard}</div>
      ) : (
        view !== "transcript" && actionsCard
      )}
      {canStartMinutes && view !== "transcript" && <TurnIntoMinutesBar converting={converting} disabled={tooLong} onTurn={() => { void turnIntoMinutes(); }} />}
      <MeetingAskBar context={() => ({ ...exportInput(), people: meeting.attendeeIds })} />
    </div>
    </MentionPeopleContext.Provider>
  );
}

type NotesController = ReturnType<typeof useAutosavedNotes>;

function NotesDocCard({ notes, canWrite, converting, tooLong, onPickTemplate }: {
  notes: NotesController;
  canWrite: boolean;
  converting: boolean;
  tooLong: boolean;
  onPickTemplate: (template: NotesDraftTemplateId) => void;
}) {
  const confirm = useConfirm();
  return (
    <section className="card meeting-notes-doc" aria-label="Team notes">
      <div className="card__body meeting-notes-doc__body" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) notes.flushInBackground();
      }}>
        <MeetingDraftRecovery draft={notes.recovery} label="notes" onRestore={notes.restore} disabled={!canWrite || notes.saveState !== "saved"} />
        {notes.recovered && <div className="flag flag--warn" role="status">
          <p>Recovered notes are ready to review. Saving uses their original server version, so newer work by someone else will cause a conflict.</p>
          <button type="button" className="btn-action" disabled={!canWrite} onClick={() => { void notes.saveRecovered().catch(() => undefined); }}>Save recovered draft</button>
          <button type="button" className="btn-action" onClick={notes.useLatestServer}>Discard restored notes</button>
        </div>}
        {canWrite && !notes.value.trim() && <NotesTemplateStarter onPick={onPickTemplate} />}
        <MarkdownEditor
          className="markdown-editor--document"
          value={notes.value}
          onChange={notes.onChange}
          readOnly={!canWrite || converting}
          rows={14}
          aria-label="Meeting notes"
          placeholder="Who came, what was discussed, what was decided, who is following up."
          aria-invalid={tooLong || undefined}
          // In the toolbar, which stays pinned while you write further down.
          toolbarEnd={canWrite && (
            <EditorSaveStatus state={notes.saveState} onRetry={notes.conflict ? undefined : notes.flushInBackground} />
          )}
        />
        {tooLong && (
          <p className="flag flag--warn" role="alert">
            These notes are too long to save. Move long material into a document or the transcript.
          </p>
        )}
        {notes.saveState === "error" && (
          <div className="flag flag--warn" role="alert">
            <p>
              {notes.conflict
                ? "Someone else saved changes to the same part of these notes. Keep both puts your changes under theirs; nothing is lost."
                : <>{notes.error || "The notes could not be saved."} Your draft is still in the editor.</>}
            </p>
            <div className="row" style={{ gap: 8 }}>
              {notes.conflict
                ? <button type="button" className="btn-action" onClick={() => { void notes.keepBoth().catch(() => undefined); }} disabled={!canWrite}>Keep both</button>
                : <button type="button" className="btn-action" onClick={notes.flushInBackground} disabled={!canWrite}>Retry save</button>}
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
  );
}

function TurnIntoMinutesBar({ converting, disabled, onTurn }: { converting: boolean; disabled: boolean; onTurn: () => void }) {
  return (
    <div className="meeting-notes-tab__actions">
      <button type="button" className="btn btn--accent" onClick={onTurn} disabled={converting || disabled}>
        {converting ? "Starting minutes…" : "Turn notes into minutes"}
      </button>
      <span className="meeting-notes-tab__actions-hint">
        Adds the agenda, motions, quorum and approval. Your notes start the draft; decisions and action items carry over.
      </span>
    </div>
  );
}

/** The AI notes appended under the person's own notes, never in place of them. */
function appendMarkdown(current: string, markdown: string) {
  const kept = current.trimEnd();
  return kept ? `${kept}\n\n${markdown}` : markdown;
}
