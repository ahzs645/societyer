/** One staged, recoverable task editor for the register and global create action. */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { taskEditBaseline, taskOptionalPatch, type TaskEditBaseline } from "../../../shared/taskEditing";
import { isHistoricalSourceAction } from "../../../shared/taskStatus";
import { newTaskChecklistId, normalizeTaskChecklist, type TaskChecklistItem } from "../../../shared/taskChecklist";
import { Drawer } from "../../components/ui";
import { Modal, useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useCurrentUserId } from "../../hooks/useCurrentUser";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { MeetingDraftRecovery, MeetingDraftScopeContext, useMeetingDraftScope } from "../meetings/useMeetingDraft";
import { useMeetingFormDraft } from "../meetings/useMeetingFormDraft";
import { meetingDraftIdentityKey } from "../meetings/lib/meetingDraftStore";
import { useDirtyCloseGuard } from "../meetings/lib/useDirtyCloseGuard";
import { TaskFormFields, makeTaskFormDefaults, type TaskFormData, type TaskFormInitialValues, type TaskFormValue } from "./TaskFormFields";
import { TaskChecklist } from "./TaskChecklist";
import { TaskDiscussion, TaskStateBanner } from "./TaskDetailExtras";
import { HistoricalActionSource } from "./HistoricalActionSource";
import { isoDay, startOfToday, type TaskRecord } from "./taskModel";

type Draft = TaskFormValue & { tags: string[]; checklist: TaskChecklistItem[]; checklistDraft: string };
type Props = {
  task?: TaskRecord | null;
  societyId: Id<"societies">;
  data: TaskFormData;
  canManage: boolean;
  initialValues?: TaskFormInitialValues;
  presentation?: "drawer" | "modal";
  onClose: () => void;
  onCreated?: (id: Id<"tasks">) => void;
  onPromote?: (task: TaskRecord) => Promise<void>;
};

export function TaskEditDrawer(props: Props) {
  const userId = useCurrentUserId();
  // Reuse the tested journal/controller. Prefix the record key to keep task and meeting drafts separate.
  const scope = useMeetingDraftScope(`task:${props.task?._id ?? "new"}`, props.societyId, userId, "task");
  if (!scope) return <Drawer open onClose={props.onClose} title="Task"><p>Verify your account and select this workspace before editing or recovering a task draft.</p></Drawer>;
  return <MeetingDraftScopeContext.Provider value={scope}>
    <TaskEditor key={meetingDraftIdentityKey(scope.identity)} {...props} />
  </MeetingDraftScopeContext.Provider>;
}

function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const row = value as Draft;
  const defaults = makeTaskFormDefaults();
  return Object.keys(defaults).every((key) => key === "responsibleUserIds" || typeof row[key as keyof TaskFormValue] === "string")
    && Array.isArray(row.responsibleUserIds) && row.responsibleUserIds.every((id) => typeof id === "string")
    && typeof row.checklistDraft === "string"
    && Array.isArray(row.tags) && row.tags.every((tag) => typeof tag === "string")
    && Array.isArray(row.checklist) && row.checklist.every((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.done === "boolean");
}
function TaskEditor({ task, societyId, data, canManage, initialValues, presentation = "drawer", onClose, onCreated, onPromote }: Props) {
  const update = usePermissionedMutation(api.tasks.update, canManage);
  const create = usePermissionedMutation(api.tasks.create, canManage);
  const remove = usePermissionedMutation(api.tasks.remove, canManage);
  const toast = useToast();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const state = useMeetingFormDraft<Draft, TaskEditBaseline>("task-form", isDraft,
    (value): value is TaskEditBaseline => !!value && typeof value === "object" && !Array.isArray(value));
  const { controller } = state;
  const form = state.value;
  useEffect(() => {
    if (controller.getSnapshot()) return;
    controller.begin({
      ...makeTaskFormDefaults(task ? {
        ...task, responsibleUserIds: task.responsibleUserIds?.map(String) ?? [],
      } : initialValues),
      tags: task?.tags ?? [], checklist: task?.checklist ?? [], checklistDraft: "",
    }, task ? taskEditBaseline(task) : {});
    // This editor is keyed by identity and remounted when reopened. Query updates must never reset typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  const dirty = controller.dirty();
  const close = useDirtyCloseGuard(dirty, () => { controller.discard(); onClose(); }, "task edits");
  const guardedClose = () => { if (!inFlight.current) void close(); };
  const patch = (value: Partial<Draft>) => controller.change((current) => ({ ...current, ...value }));

  const save = async () => {
    if (!canManage || inFlight.current) return;
    const submitted = controller.capture();
    if (!submitted) return;
    const form = submitted.payload.value;
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    inFlight.current = true; setSaving(true);
    try {
      if (form.checklist.some((item) => !item.title.trim())) throw new Error("Give each checklist step a title, or remove the blank step.");
      const checklist = normalizeTaskChecklist([...form.checklist, ...(form.checklistDraft.trim() ? [{ id: newTaskChecklistId(), title: form.checklistDraft, done: false }] : [])]);
      const optional = taskOptionalPatch(form);
      const { clearFields, ...values } = optional;
      const fields = {
        ...values,
        title: form.title.trim(), status: form.status, priority: form.priority,
        responsibleUserIds: form.responsibleUserIds as Id<"users">[],
        tags: form.tags, checklist,
      };
      if (task) {
        await update({ id: task._id, expected: submitted.payload.baseline, patch: { ...fields, clearFields } });
      } else {
        // completionNote is edit-only. All other optional values share the same clear/set contract.
        const { completionNote: _completion, ...createFields } = fields;
        const id = await create({ societyId, ...createFields });
        if (controller.isCurrent(submitted)) onCreated?.(id as Id<"tasks">);
      }
      const active = controller.isCurrent(submitted);
      const closed = controller.complete(submitted, taskEditBaseline({ ...fields }));
      if (active) {
        toast.success(task ? "Task updated" : "Task created", form.title);
        if (closed) onClose();
      }
    } catch (error) {
      if (controller.isCurrent(submitted)) toast.error("Could not save task", error instanceof Error ? error.message : "Please try again.");
    } finally { inFlight.current = false; setSaving(false); }
  };

  const deleteTask = async () => {
    if (!task || !canManage || inFlight.current) return;
    if (!await confirm({ title: "Delete task?", message: `"${task.title}" will be permanently removed.`, confirmLabel: "Delete", tone: "danger" })) return;
    if (!state.recovery.journal?.isActive()) return;
    inFlight.current = true; setSaving(true);
    try {
      await remove({ id: task._id });
      if (state.recovery.journal?.isActive()) { controller.discard(); toast.success("Task deleted"); onClose(); }
    } catch (error) { toast.error("Could not delete task", error instanceof Error ? error.message : "Please try again."); }
    finally { inFlight.current = false; setSaving(false); }
  };

  const title = task ? (canManage ? "Edit task" : "View task") : "New task";
  const footer = <>
    {task && <button type="button" className="btn btn--danger" style={{ marginRight: "auto" }} disabled={!canManage || saving} onClick={() => void deleteTask()}>Delete</button>}
    <button type="button" className="btn" onClick={guardedClose} disabled={saving}>Cancel</button>
    <button type="button" className="btn btn--accent" onClick={() => void save()} disabled={!canManage || saving || !form?.title.trim()}>
      {saving ? "Saving…" : task ? "Save" : "Create"}
    </button>
  </>;
  const content = form && <>
    <MeetingDraftRecovery draft={state.recovery} label="task" recordLabel="task" disabled={!canManage || dirty || saving} onRestore={controller.restore}
      recoveryNotice={task ? "A restored draft is tied to the version of this task it was started from. If the task has changed since, saving it will be refused; discard the recovery copy and make your edits on the latest version instead." : undefined} />
    <p className="muted" role="status">Fields and checklist changes are saved together when you choose {task ? "Save" : "Create"}. Unsaved edits are recoverable here when the draft-saved message is shown.</p>
    {task && <TaskStateBanner task={{ ...task, status: form.status, dueDate: form.dueDate }} canManage={canManage && !saving}
      onReopen={() => patch({ status: "Todo" })}
      onRescheduleToday={() => patch({ dueDate: isoDay(startOfToday()) })} />}
    {task && (isHistoricalSourceAction(task) || task.sourceObservations?.length || task.meetingId) &&
      <HistoricalActionSource task={task} meetingTitle={task.meetingIdLabel}
        onPromote={canManage && !dirty && !saving && isHistoricalSourceAction(task) && onPromote ? async () => { await onPromote(task); controller.discard(); onClose(); } : undefined} />}
    <fieldset disabled={!canManage || saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <TaskFormFields readOnly={!canManage || saving} value={form} onChange={patch} data={data} mode={task ? "edit" : "create"} />
      <TaskChecklist draft={form.checklistDraft} onDraftChange={(checklistDraft) => patch({ checklistDraft })} items={form.checklist} onChange={(checklist) => patch({ checklist })} readOnly={!canManage || saving} />
    </fieldset>
    {task && <TaskDiscussion taskId={String(task._id)} />}
  </>;
  return presentation === "modal"
    ? <Modal open onClose={guardedClose} title={title} size="md" footer={footer}>{content}</Modal>
    : <Drawer open onClose={guardedClose} title={title} footer={footer}>{content}</Drawer>;
}
