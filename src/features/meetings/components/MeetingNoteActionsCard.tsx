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
import { ListChecks, Plus, Sparkles, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "@/components/ui";
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

  const save = async (next: NoteActionItem[]) => {
    try {
      await setItems({ id: meetingId, items: next as any });
    } catch (error) {
      toast.error("Could not save the action items", error instanceof Error ? error.message : String(error));
    }
  };
  // Any edit makes a suggestion the person's own: a redraft keeps it.
  const patch = (id: string, change: Partial<NoteActionItem>) =>
    save(items.map((item) => (item.id === id ? withoutEmpty({ ...item, ...change, origin: "manual" }) : item)));

  const add = async () => {
    const text = newText.replace(/\s+/g, " ").trim();
    if (!text) return;
    await save([...items, { id: newNoteActionId(), text, done: false, status: "open", origin: "manual" }]);
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
              onRemove={() => { void save(items.filter((entry) => entry.id !== item.id)); }}
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
  return (
    <li className={`meeting-note-action${item.done ? " is-done" : ""}`}>
      <div className="meeting-note-action__main">
        <input
          type="checkbox"
          checked={item.done}
          disabled={!canWrite}
          aria-label={item.done ? `Reopen: ${item.text}` : `Mark done: ${item.text}`}
          onChange={(event) => { onPatch({ done: event.target.checked, status: event.target.checked ? "completed" : "open" }); }}
        />
        <input
          key={`${item.id}:${item.text}`}
          className="input meeting-note-action__text"
          defaultValue={item.text}
          readOnly={!canWrite}
          aria-label="Action item"
          onBlur={(event) => {
            const text = event.target.value.replace(/\s+/g, " ").trim();
            if (text && text !== item.text) onPatch({ text });
            else event.target.value = item.text;
          }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        {item.origin === "ai" && (
          <Badge tone="info"><Sparkles size={10} aria-hidden="true" /> Suggested</Badge>
        )}
        <TranscriptTimeChip transcriptRef={item.transcriptRef} label={item.text} />
        {canWrite && (
          <button
            type="button"
            className="btn-action btn-action--icon"
            aria-label={`Remove: ${item.text}`}
            title={item.taskId ? "Remove from the notes. Its task stays on the task board." : "Remove"}
            onClick={onRemove}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="meeting-note-action__links">
        <div className="meeting-note-action__field">
          <PersonNameLinkField
            compact
            ariaLabel="Who"
            placeholder="Who"
            value={{ name: item.assignee ?? "", personId: item.assigneePersonId }}
            people={people}
            onChange={(next) => {
              if (!canWrite || (next.name === (item.assignee ?? "") && next.personId === item.assigneePersonId)) return;
              onPatch({ assignee: next.name, assigneePersonId: next.personId });
            }}
          />
        </div>
        <input
          className="input meeting-note-action__due"
          type="date"
          aria-label="Due date"
          value={item.dueDate ?? ""}
          disabled={!canWrite}
          onChange={(event) => { onPatch({ dueDate: event.target.value || undefined }); }}
        />
        <div className="meeting-note-action__select">
          <Select
            aria-label="Goal"
            value={item.goalId ?? ""}
            disabled={!canWrite || !goalsLoaded}
            options={goalOptions}
            onChange={(value) => { onPatch({ goalId: value || undefined }); }}
          />
        </div>
        <div className="meeting-note-action__select">
          <Select
            aria-label="Committee"
            value={item.committeeId ?? ""}
            disabled={!canWrite}
            options={committeeOptions}
            onChange={(value) => { onPatch({ committeeId: value || undefined }); }}
          />
        </div>
        {task ? (
          <Link className="btn-action" to="/app/tasks" title={`Task: ${task.title}`}>
            Task · {taskStatusLabel(task.status)}
          </Link>
        ) : item.taskId ? (
          <span className="muted">Task created</span>
        ) : canWrite && canCreateTasks ? (
          <button type="button" className="btn-action" disabled={creating} onClick={onCreateTask}>
            {creating ? "Creating…" : "Create task"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Drops cleared optional fields: Convex keeps a field that is sent as undefined out of the row. */
function withoutEmpty(item: NoteActionItem): NoteActionItem {
  const out = { ...item } as Record<string, unknown>;
  for (const key of ["assignee", "assigneePersonId", "dueDate", "goalId", "committeeId"]) {
    if (out[key] === undefined || out[key] === "") delete out[key];
  }
  return out as NoteActionItem;
}
