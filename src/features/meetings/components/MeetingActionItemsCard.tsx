/**
 * Minutes action items (A12, B6, ui-meetings F16/F19): every action recorded in
 * the minutes — top-level and per agenda section — with its status from the
 * shared vocabulary (open, in progress, ongoing, on hold, completed,
 * cancelled, not stated), the assignee linked to the people directory, the due
 * date, and "Create task" to track it on the task board.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui";
import { Select } from "@/components/Select";
import { ACTION_ITEM_STATUSES, ACTION_ITEM_STATUS_LABELS, actionItemStatus, type ActionItemStatus } from "../../../../shared/actionItemStatus";
import { taskDraftFromActionItem } from "../../../../shared/meetingActionTasks";
import { PersonNameLinkField, type DirectoryPerson } from "../../../components/PersonNameLinkField";

const STATUS_OPTIONS = ACTION_ITEM_STATUSES.map((value) => ({ value, label: ACTION_ITEM_STATUS_LABELS[value] }));

type Row = { item: any; sectionIndex: number | null; actionIndex: number; sectionTitle?: string };

export function MeetingActionItemsCard({
  sections,
  topLevelItems,
  people,
  meetingTasks,
  canEdit,
  canCreateTasks,
  meetingTitle,
  saveSections,
  saveTopLevel,
  createTask,
}: {
  sections: any[];
  topLevelItems: any[];
  people?: DirectoryPerson[];
  meetingTasks: any[];
  canEdit: boolean;
  canCreateTasks: boolean;
  meetingTitle?: string;
  saveSections: (next: any[]) => void | Promise<void>;
  saveTopLevel?: (items: any[]) => void | Promise<void>;
  createTask?: (draft: ReturnType<typeof taskDraftFromActionItem>) => Promise<string | undefined>;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const rows: Row[] = [
    ...topLevelItems.map((item, actionIndex) => ({ item, sectionIndex: null, actionIndex })),
    ...sections.flatMap((section: any, sectionIndex: number) =>
      (section?.actionItems ?? []).map((item: any, actionIndex: number) => ({ item, sectionIndex, actionIndex, sectionTitle: section.title || `Agenda item ${sectionIndex + 1}` })),
    ),
  ].filter((row) => String(row.item?.text ?? "").trim());
  if (!rows.length) return null;
  const taskById = new Map((meetingTasks ?? []).map((task: any) => [String(task._id), task]));
  const open = rows.filter((row) => !["completed", "cancelled"].includes(actionItemStatus(row.item))).length;

  const patchItem = async (row: Row, diff: Record<string, unknown>) => {
    const apply = (item: any) => {
      const next = { ...item, ...diff };
      if (typeof diff.status === "string") next.done = diff.status === "completed";
      return next;
    };
    if (row.sectionIndex == null) {
      if (!saveTopLevel) return;
      await saveTopLevel(topLevelItems.map((item, index) => (index === row.actionIndex ? apply(item) : item)));
      return;
    }
    await saveSections(sections.map((section: any, index: number) => index !== row.sectionIndex ? section : {
      ...section,
      actionItems: (section.actionItems ?? []).map((item: any, actionIndex: number) => (actionIndex === row.actionIndex ? apply(item) : item)),
    }));
  };

  const makeTask = async (row: Row, key: string) => {
    if (!createTask) return;
    setBusyKey(key);
    try {
      const taskId = await createTask(taskDraftFromActionItem(row.item, { meetingTitle, sectionTitle: row.sectionTitle }));
      if (taskId) await patchItem(row, { taskId });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="card" id="meeting-minutes-action-items" data-testid="action-items-card">
      <div className="card__head">
        <h2 className="card__title"><ListChecks size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Action items</h2>
        <span className="card__subtitle">{open} open · {rows.length} total</span>
      </div>
      <div className="card__body">
        <div className="action-list action-list--compact">
          {rows.map((row) => {
            const key = `${row.sectionIndex ?? "top"}-${row.actionIndex}`;
            const status = actionItemStatus(row.item) as ActionItemStatus;
            const task = row.item.taskId ? taskById.get(String(row.item.taskId)) : undefined;
            const editing = editingKey === key;
            return (
              <div className="action-item action-item--rich" key={key} data-testid="action-item">
                <span className={`action-item__text${status === "completed" ? " done" : ""}`}>
                  <span>{row.item.text}</span>
                  <span className="action-item__context">
                    {row.sectionIndex == null ? "Minutes" : `${row.sectionIndex + 1}. ${row.sectionTitle}`}
                    {row.item.sourceStatus ? ` · source: “${row.item.sourceStatus}”` : ""}
                  </span>
                </span>
                <div className="action-item__controls">
                  <div className="action-item__status">
                    <Select
                      value={status}
                      onChange={(next) => { void patchItem(row, { status: next }); }}
                      options={STATUS_OPTIONS}
                      size="sm"
                      disabled={!canEdit}
                      aria-label={`Status of action: ${row.item.text}`}
                    />
                  </div>
                  {editing ? (
                    <PersonNameLinkField
                      value={{ name: row.item.assignee ?? "", personId: row.item.assigneePersonId }}
                      people={people}
                      ariaLabel={`Assignee of action: ${row.item.text}`}
                      placeholder="Assignee"
                      onChange={(next) => { void patchItem(row, { assignee: next.name || undefined, assigneePersonId: next.personId }); }}
                    />
                  ) : (
                    <button type="button" className="btn-action" disabled={!canEdit} onClick={() => setEditingKey(key)} title="Change assignee">
                      {row.item.assignee ? <>{row.item.assignee}{row.item.assigneePersonId ? " ✓" : ""}</> : "Assign…"}
                    </button>
                  )}
                  {row.item.dueDate && <span className="action-item__due">{row.item.dueDate}</span>}
                  {task ? (
                    <Link className="btn-action" to="/app/tasks" title={`Task: ${task.title}`}>
                      <ClipboardList size={12} /> {task.status}
                    </Link>
                  ) : row.item.taskId ? (
                    <Badge tone="neutral">Task linked</Badge>
                  ) : canCreateTasks && createTask ? (
                    <button type="button" className="btn-action" disabled={busyKey === key || !canEdit} onClick={() => { void makeTask(row, key); }} data-testid="create-task-from-action">
                      <ClipboardList size={12} /> {busyKey === key ? "Creating…" : "Create task"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
