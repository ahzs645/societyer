/**
 * Sub-tasks: one level of full tasks under a parent. The drawer section
 * adds, ticks, opens and deletes them straight away (they are their own
 * tasks, not part of the parent's draft); a sub-task's drawer links back to
 * its parent and can be made a separate task. Rows and cards show the
 * parent's progress and a sub-task's parent.
 */
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { CornerDownRight, ListTree, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { isHistoricalSourceAction } from "../../../shared/taskStatus";
import { subtaskProgress } from "../../../shared/taskSchedule";
import { sortByPosition } from "../../../shared/taskPosition";
import { Checkbox } from "../../components/Controls";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { TaskDue, TaskStatusIcon } from "./TaskVisuals";

/** Live view of one task and its sub-tasks, from the workspace task list. */
export function useTaskFamily(societyId: Id<"societies">, taskId: string | undefined) {
  const tasks: Doc<"tasks">[] | undefined = useQuery(api.tasks.list, taskId ? { societyId } : "skip");
  return useMemo(() => {
    if (!taskId || !tasks) return { task: undefined, parent: undefined, children: [] as Doc<"tasks">[] };
    const task = tasks.find((row) => String(row._id) === taskId);
    const parent = task?.parentTaskId ? tasks.find((row) => row._id === task.parentTaskId) : undefined;
    const children = sortByPosition(tasks.filter((row) => String(row.parentTaskId ?? "") === taskId));
    return { task, parent, children };
  }, [tasks, taskId]);
}

export function TaskSubtaskBadge({ progress }: { progress?: { done: number; total: number } }) {
  if (!progress || progress.total === 0) return null;
  const complete = progress.done === progress.total;
  return (
    <span className={`task-subtask-badge${complete ? " is-complete" : ""}`} title={`${progress.done} of ${progress.total} sub-tasks done`}>
      <ListTree size={12} aria-hidden="true" />
      {progress.done} of {progress.total}
    </span>
  );
}

export function TaskParentHint({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <span className="task-parent-hint" title={`Sub-task of ${title}`}>
      <CornerDownRight size={11} aria-hidden="true" />
      <span className="task-parent-hint__label">{title}</span>
    </span>
  );
}

/** Unknown and Cancelled sub-tasks show their status instead of a tick box. */
const TICKABLE_STATUSES = new Set(["Todo", "InProgress", "Blocked", "Done"]);

type SectionProps = {
  societyId: Id<"societies">;
  /** The task as the drawer opened it; the live row wins once loaded. */
  task: Doc<"tasks">;
  family: ReturnType<typeof useTaskFamily>;
  canManage: boolean;
  /** Open another task in the drawer (absent where the drawer can't switch). */
  onOpenTask?: (id: string) => void;
};

/** "Sub-task of …" with "Make this a separate task", or the parent's sub-task list. */
export function TaskSubtasksSection({ societyId, task, family, canManage, onOpenTask }: SectionProps) {
  const live = family.task ?? task;
  if (isHistoricalSourceAction(live)) return null;
  if (live.parentTaskId) return <TaskParentLink task={live} parent={family.parent} canManage={canManage} onOpenTask={onOpenTask} />;
  return <TaskSubtaskList societyId={societyId} parent={live} subtasks={family.children} canManage={canManage} onOpenTask={onOpenTask} />;
}

function TaskParentLink({ task, parent, canManage, onOpenTask }: { task: Doc<"tasks">; parent?: Doc<"tasks">; canManage: boolean; onOpenTask?: (id: string) => void }) {
  const update = usePermissionedMutation(api.tasks.update, canManage);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const separate = async () => {
    setBusy(true);
    try {
      await update({ id: task._id, patch: { clearFields: ["parentTaskId"] } });
      toast.success("Now a separate task", task.title);
    } catch (error) {
      toast.error("Could not separate the task", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="task-subtasks task-subtasks--parent" aria-label="Parent task">
      <span className="task-subtasks__parent">
        <CornerDownRight size={14} aria-hidden="true" />
        <span className="muted">Sub-task of</span>
        {parent && onOpenTask ? (
          <button type="button" className="task-subtasks__link" onClick={() => onOpenTask(String(parent._id))}>{parent.title}</button>
        ) : (
          <strong>{parent?.title ?? "another task"}</strong>
        )}
      </span>
      {canManage && (
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void separate()}>
          Make this a separate task
        </button>
      )}
    </section>
  );
}

function TaskSubtaskList({ societyId, parent, subtasks, canManage, onOpenTask }: { societyId: Id<"societies">; parent: Doc<"tasks">; subtasks: Doc<"tasks">[]; canManage: boolean; onOpenTask?: (id: string) => void }) {
  const create = usePermissionedMutation(api.tasks.create, canManage);
  const update = usePermissionedMutation(api.tasks.update, canManage);
  const remove = usePermissionedMutation(api.tasks.remove, canManage);
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const { done, total } = subtaskProgress(subtasks);

  const add = async () => {
    const title = draft.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await create({
        societyId,
        title,
        status: "Todo",
        priority: "Medium",
        parentTaskId: parent._id,
        // A sub-task belongs to the same committee and goal as its parent.
        committeeId: parent.committeeId,
        goalId: parent.goalId,
        tags: [],
      });
      setDraft("");
    } catch (error) {
      toast.error("Could not add the sub-task", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setAdding(false);
    }
  };
  const toggle = async (subtask: Doc<"tasks">, checked: boolean) => {
    try {
      await update({ id: subtask._id, patch: { status: checked ? "Done" : "Todo" } });
    } catch (error) {
      toast.error("Could not change the sub-task", error instanceof Error ? error.message : "Please try again.");
    }
  };
  const deleteSubtask = async (subtask: Doc<"tasks">) => {
    if (!await confirm({ title: "Delete sub-task?", message: `"${subtask.title}" will be permanently removed.`, confirmLabel: "Delete", tone: "danger" })) return;
    try {
      await remove({ id: subtask._id });
      toast.success("Sub-task deleted", subtask.title);
    } catch (error) {
      toast.error("Could not delete the sub-task", error instanceof Error ? error.message : "Please try again.");
    }
  };

  if (!canManage && subtasks.length === 0) return null;
  return (
    <section className="task-subtasks" aria-label="Sub-tasks">
      <div className="task-checklist__head">
        <span className="task-checklist__title">Sub-tasks</span>
        {total > 0 && (
          <>
            <span className="task-checklist__count">{done} of {total}</span>
            <span className="task-checklist__bar" aria-hidden="true"><span style={{ width: `${(done / total) * 100}%` }} /></span>
          </>
        )}
      </div>
      <p className="muted task-subtasks__note">Sub-tasks are saved straight away.</p>
      {subtasks.length > 0 && (
        <ul className="task-subtasks__items">
          {subtasks.map((subtask) => {
            const isDone = subtask.status === "Done";
            return (
              <li key={subtask._id} className={`task-subtasks__item${isDone ? " is-done" : ""}`}>
                {TICKABLE_STATUSES.has(subtask.status) ? (
                  <Checkbox bare checked={isDone} disabled={!canManage} ariaLabel={`${isDone ? "Reopen" : "Complete"} ${subtask.title}`} onChange={(checked) => void toggle(subtask, checked)} />
                ) : (
                  <TaskStatusIcon status={subtask.status} />
                )}
                {onOpenTask ? (
                  <button type="button" className="task-subtasks__title" onClick={() => onOpenTask(String(subtask._id))}>{subtask.title}</button>
                ) : (
                  <span className="task-subtasks__title">{subtask.title}</span>
                )}
                <TaskDue dueDate={subtask.dueDate} status={subtask.status} />
                {canManage && (
                  <button type="button" className="task-icon-button task-subtasks__remove" aria-label={`Delete sub-task ${subtask.title}`} onClick={() => void deleteSubtask(subtask)}>
                    <X size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canManage && (
        <input
          className="input task-checklist__add"
          value={draft}
          maxLength={300}
          disabled={adding}
          aria-label="Add a sub-task"
          placeholder="Add a sub-task and press Enter"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void add(); } }}
        />
      )}
    </section>
  );
}
