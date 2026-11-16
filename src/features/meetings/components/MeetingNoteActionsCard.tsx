/**
 * Action items for a meeting that keeps notes (`meetings.noteActionItems`,
 * shared/meetingNoteActions.ts). Suggested items arrive from "Draft notes";
 * anyone with meeting edit access adds, edits, ticks off and removes them.
 * Each can link a person, a goal and a committee, and "Create task" turns it
 * into a task that carries those links and the moment in the recording.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { CalendarDays, ListChecks, Plus, Sparkles, Target, User, Users, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { PersonNameLinkField, type DirectoryPerson } from "../../../components/PersonNameLinkField";
import { taskStatusLabel } from "../../../../shared/taskStatus";
import { newNoteActionId, type NoteActionItem } from "../../../../shared/meetingNoteActions";
import type { Id } from "../../../../convex/_generated/dataModel";
import { TranscriptTimeChip } from "../transcript/TranscriptTimeChip";

type LinkedTask = { _id: string; title: string; status: string };

export function MeetingNoteActionsCard({
  societyId,
  meetingId,
  items,
  people,
  committees,
  tasks,
  canWrite,
  canCreateTasks,
}: {
  societyId: Id<"societies">;
  meetingId: Id<"meetings">;
  items: NoteActionItem[];
  people?: DirectoryPerson[];
  committees?: ReadonlyArray<{ _id: string; name: string }>;
  tasks?: ReadonlyArray<LinkedTask>;
  canWrite: boolean;
  canCreateTasks: boolean;
}) {
  const toast = useToast();
  const { can } = usePermissions();
  const goals = useQuery(api.goals.list, can("commitments:read") ? { societyId } : "skip") as Array<{ _id: string; title: string; status?: string }> | undefined;
  const setItems = usePermissionedMutation(api.meetings.setNoteActionItems, canWrite);
  const createTask = usePermissionedMutation(api.meetings.createTaskFromNoteAction, canWrite && canCreateTasks);
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const taskById = useMemo(() => new Map((tasks ?? []).map((task) => [String(task._id), task])), [tasks]);
  const goalOptions = useMemo(
    () => [{ value: "", label: "No goal" }, ...(goals ?? []).map((goal) => ({ value: String(goal._id), label: goal.title }))],
    [goals],
  );
  const committeeOptions = useMemo(
    () => [{ value: "", label: "No committee" }, ...(committees ?? []).map((committee) => ({ value: String(committee._id), label: committee.name }))],
    [committees],
  );

  // Each change is applied to the list as it is on the server, so edits by
  // someone else (or a task just created) are never overwritten.
  const send = async (ops: unknown[]) => {
    try {
      await setItems({ id: meetingId, ops: ops as any });
    } catch (error) {
      toast.error("Could not save the action items", error instanceof Error ? error.message : String(error));
    }
  };
  // Any edit makes a suggestion the person's own: a redraft keeps it.
  const patch = (id: string, change: Partial<NoteActionItem>) => {
    const set: Record<string, unknown> = { origin: "manual" };
    const unset: string[] = [];
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined || value === "") unset.push(key);
      else set[key] = value;
    }
    return send([{ op: "patch", itemId: id, set, ...(unset.length ? { unset } : {}) }]);
  };

  const add = async () => {
    const text = newText.replace(/\s+/g, " ").trim();
    if (!text) return;
    await send([{ op: "add", item: { id: newNoteActionId(), text, done: false, status: "open", origin: "manual" } }]);
    setNewText("");
  };

  const makeTask = async (item: NoteActionItem) => {
    setBusy(item.id);
    try {
      const result = (await createTask({ id: meetingId, itemId: item.id })) as { created: boolean } | undefined;
      toast.success(result?.created === false ? "Already on the task board." : "Task created.", item.text);
    } catch (error) {
      toast.error("Could not create the task", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const openCount = items.filter((item) => !item.done && item.status !== "cancelled").length;

  return (
    <section className="card meeting-note-actions" aria-labelledby="meeting-note-actions-title">
      <div className="card__head">
        <h2 className="card__title" id="meeting-note-actions-title">
          <ListChecks size={14} aria-hidden="true" /> Action items
        </h2>
        {items.length > 0 && <span className="card__subtitle">{openCount} open of {items.length}</span>}
      </div>
      <div className="card__body meeting-note-actions__body">
        {!items.length && (
          <p className="muted">
            {canWrite ? "No action items yet. Add one below, or draft the notes with AI to get suggestions." : "No action items."}
          </p>
        )}
        <ul className="meeting-note-actions__list">
          {items.map((item) => (
            <NoteActionRow
              key={item.id}
              item={item}
              task={item.taskId ? taskById.get(String(item.taskId)) : undefined}
              people={people}
              goalOptions={goalOptions}
              goalsLoaded={Boolean(goals)}
              committeeOptions={committeeOptions}
              canWrite={canWrite}
              canCreateTasks={canCreateTasks}
              creating={busy === item.id}
              onPatch={(change) => { void patch(item.id, change); }}
              onRemove={() => { void send([{ op: "remove", itemId: item.id }]); }}
              onCreateTask={() => { void makeTask(item); }}
            />
          ))}
        </ul>
        {canWrite && (
          <form
            className="meeting-note-actions__add"
            onSubmit={(event) => { event.preventDefault(); void add(); }}
          >
            <input
              className="input"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              placeholder="Sam to send the budget to the funder by Friday"
              aria-label="New action item"
            />
            <button type="submit" className="btn-action" disabled={!newText.trim()}>
              <Plus size={12} aria-hidden="true" /> Add
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

type Option = { value: string; label: string };

function NoteActionRow({
  item,
  task,
  people,
  goalOptions,
  goalsLoaded,
  committeeOptions,
  canWrite,
  canCreateTasks,
  creating,
  onPatch,
  onRemove,
  onCreateTask,
}: {
  item: NoteActionItem;
  task: LinkedTask | undefined;
  people?: DirectoryPerson[];
  goalOptions: Option[];
  goalsLoaded: boolean;
  committeeOptions: Option[];
  canWrite: boolean;
  canCreateTasks: boolean;
  creating: boolean;
  onPatch: (change: Partial<NoteActionItem>) => void;
  onRemove: () => void;
  onCreateTask: () => void;
}) {
  const [open, setOpen] = useState(false);
  const due = item.dueDate ? new Date(`${item.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const goal = item.goalId ? goalOptions.find((option) => option.value === item.goalId)?.label : undefined;
  const committee = item.committeeId ? committeeOptions.find((option) => option.value === item.committeeId)?.label : undefined;
  return (
    <li className={`meeting-note-action${item.done ? " is-done" : ""}${open ? " is-open" : ""}`}>
      <div className="meeting-note-action__main">
        <input
          type="checkbox"
          checked={item.done}
          disabled={!canWrite}
          aria-label={item.done ? `Reopen: ${item.text}` : `Mark done: ${item.text}`}
          onChange={(event) => { onPatch({ done: event.target.checked, status: event.target.checked ? "completed" : "open" }); }}
        />
        {/* Wraps instead of cutting the wording off; Enter saves. */}
        <textarea
          key={`${item.id}:${item.text}`}
          className="input meeting-note-action__text"
          rows={1}
          ref={fitToText}
          onInput={(event) => fitToText(event.currentTarget)}
          defaultValue={item.text}
          readOnly={!canWrite}
          aria-label="Action item"
          onBlur={(event) => {
            const text = event.target.value.replace(/\s+/g, " ").trim();
            if (text && text !== item.text) onPatch({ text });
            else event.target.value = item.text;
          }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
        />
        {canWrite && (
          <button
            type="button"
            className="btn-action btn-action--icon meeting-note-action__remove"
            aria-label={`Remove: ${item.text}`}
            title={item.taskId ? "Remove from the notes. Its task stays on the task board." : "Remove"}
            onClick={onRemove}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      {/* At a glance: who, when, where it came from; Details edits them. */}
      <div className="meeting-note-action__chips">
        <button type="button" className={`meeting-note-action__chip${item.assignee ? "" : " is-empty"}`} onClick={() => setOpen(true)} aria-label={item.assignee ? `Owner: ${item.assignee}` : "No owner: choose one"}>
          <User size={11} aria-hidden="true" /> {item.assignee || "No owner"}
        </button>
        {due && <button type="button" className="meeting-note-action__chip" onClick={() => setOpen(true)} aria-label={`Due ${due}`}><CalendarDays size={11} aria-hidden="true" /> {due}</button>}
        {goal && <span className="meeting-note-action__chip" title="Goal"><Target size={11} aria-hidden="true" /> {goal}</span>}
        {committee && <span className="meeting-note-action__chip" title="Committee"><Users size={11} aria-hidden="true" /> {committee}</span>}
        <TranscriptTimeChip transcriptRef={item.transcriptRef} label={item.text} />
        {item.origin === "ai" && <span className="meeting-note-action__ai" title="Suggested by the AI notes; any edit makes it yours"><Sparkles size={11} aria-hidden="true" /><span className="sr-only">Suggested</span></span>}
        {task ? (
          <Link className="meeting-note-action__chip is-task" to="/app/tasks" title={`Task: ${task.title}`}>Task · {taskStatusLabel(task.status)}</Link>
        ) : item.taskId ? (
          <span className="meeting-note-action__chip is-task">Task created</span>
        ) : null}
        {canWrite && (
          <button type="button" className="meeting-note-action__details" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? "Done" : "Details"}
          </button>
        )}
      </div>
      {open && canWrite && (
        <div className="meeting-note-action__links">
          <div className="meeting-note-action__field">
            <PersonNameLinkField
              compact
              ariaLabel="Who"
              placeholder="Who"
              value={{ name: item.assignee ?? "", personId: item.assigneePersonId }}
              people={people}
              onChange={(next) => {
                if (next.name === (item.assignee ?? "") && next.personId === item.assigneePersonId) return;
                onPatch({ assignee: next.name, assigneePersonId: next.personId });
              }}
            />
          </div>
          <input
            className="input meeting-note-action__due"
            type="date"
            aria-label="Due date"
            value={item.dueDate ?? ""}
            onChange={(event) => { onPatch({ dueDate: event.target.value || undefined }); }}
          />
          <div className="meeting-note-action__select">
            <Select aria-label="Goal" value={item.goalId ?? ""} disabled={!goalsLoaded} options={goalOptions} onChange={(value) => { onPatch({ goalId: value || undefined }); }} />
          </div>
          <div className="meeting-note-action__select">
            <Select aria-label="Committee" value={item.committeeId ?? ""} options={committeeOptions} onChange={(value) => { onPatch({ committeeId: value || undefined }); }} />
          </div>
          {!task && !item.taskId && canCreateTasks && (
            <button type="button" className="btn-action" disabled={creating} onClick={onCreateTask}>
              {creating ? "Creating…" : "Create task"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Grows the wording box to its text (field-sizing isn't in every browser yet). */
function fitToText(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight + 2}px`;
}
