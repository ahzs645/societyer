/**
 * Inline pickers shared by the task list rows and board cards: each property
 * on a row is its own small menu, so status, priority and due date change in
 * place without opening the task.
 */
import type { ReactElement, ReactNode } from "react";
import { ArrowUpRight, Check, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Menu, type MenuSection } from "../../components/Menu";
import { isHistoricalSourceAction, taskStatusLabel } from "../../../shared/taskStatus";
import { TaskDue, TaskPriorityIcon, TaskStatusIcon } from "./TaskVisuals";
import { formatDueDate } from "../../lib/format";
import { TASK_PRIORITY_ORDER, addDays, isClosedStatus, isoDay, startOfToday, type TaskRecord } from "./taskModel";

export type TaskViewActions = {
  canManage: boolean;
  open: (task: TaskRecord) => void;
  setStatus: (task: TaskRecord, status: string) => Promise<void>;
  setPriority: (task: TaskRecord, priority: string) => Promise<void>;
  setDue: (task: TaskRecord, dueDate: string) => Promise<void>;
  remove: (task: TaskRecord) => Promise<void>;
  promote?: (task: TaskRecord) => Promise<void>;
  /** Create a task from a title typed inline; resolves true when it was saved. */
  quickAdd: (title: string, defaults: Partial<{ status: string; priority: string; dueDate: string }>) => Promise<boolean>;
};

/** Menus render in a portal, but React still bubbles their clicks to the row. */
function Isolated({ children }: { children: ReactNode }) {
  return (
    <span className="task-menu-anchor" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {children}
    </span>
  );
}

function trigger(element: ReactElement) {
  return element;
}

const MENU_STATUSES = ["Todo", "InProgress", "Blocked", "Done", "Cancelled"];

export function statusMenuSections(task: TaskRecord, actions: TaskViewActions): MenuSection[] {
  // Unknown is only ever imported; offer it back only while the task holds it.
  const statuses = MENU_STATUSES.includes(task.status) ? MENU_STATUSES : [...MENU_STATUSES, task.status];
  return [{
    id: "status",
    label: "Status",
    items: statuses.map((status) => ({
      id: status,
      label: taskStatusLabel(status),
      icon: <TaskStatusIcon status={status} />,
      hint: status === task.status ? <Check size={12} aria-label="Current" /> : undefined,
      disabled: !actions.canManage,
      onSelect: () => void actions.setStatus(task, status),
    })),
  }];
}

export function TaskStatusMenu({ task, actions }: { task: TaskRecord; actions: TaskViewActions }) {
  return (
    <Isolated>
      <Menu
        trigger={trigger(
          <button type="button" className="task-icon-button" aria-label={`Status: ${taskStatusLabel(task.status)}. Change status`} title={taskStatusLabel(task.status)} disabled={!actions.canManage}>
            <TaskStatusIcon status={task.status} />
          </button>,
        )}
        sections={statusMenuSections(task, actions)}
      />
    </Isolated>
  );
}

export function TaskPriorityMenu({ task, actions }: { task: TaskRecord; actions: TaskViewActions }) {
  return (
    <Isolated>
      <Menu
        trigger={trigger(
          <button type="button" className="task-icon-button" aria-label={`Priority: ${task.priority || "none"}. Change priority`} title={`${task.priority || "No"} priority`} disabled={!actions.canManage}>
            <TaskPriorityIcon priority={task.priority} />
          </button>,
        )}
        sections={[{
          id: "priority",
          label: "Priority",
          items: TASK_PRIORITY_ORDER.map((priority) => ({
            id: priority,
            label: priority,
            icon: <TaskPriorityIcon priority={priority} />,
            hint: priority === task.priority ? <Check size={12} aria-label="Current" /> : undefined,
            onSelect: () => void actions.setPriority(task, priority),
          })),
        }]}
      />
    </Isolated>
  );
}

export function TaskDueMenu({ task, actions, emptyLabel = "" }: { task: TaskRecord; actions: TaskViewActions; emptyLabel?: string }) {
  const today = startOfToday();
  const nextMonday = addDays(today, ((8 - today.getDay()) % 7) || 7);
  const presets = [
    { id: "today", label: "Today", value: isoDay(today) },
    { id: "tomorrow", label: "Tomorrow", value: isoDay(addDays(today, 1)) },
    { id: "next-week", label: "Next week", value: isoDay(nextMonday) },
    { id: "two-weeks", label: "In 2 weeks", value: isoDay(addDays(today, 14)) },
  ];
  return (
    <Isolated>
      <Menu
        align="right"
        trigger={trigger(
          <button type="button" className="task-due-button" aria-label={task.dueDate ? `Due ${formatDueDate(task.dueDate)}. Change due date` : "Set a due date"} disabled={!actions.canManage}>
            <TaskDue dueDate={task.dueDate} status={task.status} emptyLabel={emptyLabel} />
          </button>,
        )}
        sections={[
          {
            id: "presets",
            label: "Due date",
            items: presets.map((preset) => ({
              id: preset.id,
              label: preset.label,
              hint: new Date(`${preset.value}T00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
              onSelect: () => void actions.setDue(task, preset.value),
            })),
          },
          {
            id: "more",
            items: [
              { id: "pick", label: "Pick a date…", onSelect: () => actions.open(task) },
              ...(task.dueDate ? [{ id: "clear", label: "Remove due date", onSelect: () => void actions.setDue(task, "") }] : []),
            ],
          },
        ]}
      />
    </Isolated>
  );
}

export function TaskMoreMenu({ task, actions }: { task: TaskRecord; actions: TaskViewActions }) {
  const closed = isClosedStatus(task.status);
  return (
    <Isolated>
      <Menu
        align="right"
        trigger={trigger(
          <button type="button" className="task-icon-button task-icon-button--more" aria-label={`Actions for task ${task.title}`}>
            <MoreHorizontal size={14} />
          </button>,
        )}
        sections={[
          {
            id: "task",
            items: [
              { id: "open", label: actions.canManage ? "Open and edit" : "Open", icon: <Pencil size={14} />, onSelect: () => actions.open(task) },
              closed
                ? { id: "reopen", label: "Reopen", icon: <RotateCcw size={14} />, disabled: !actions.canManage, onSelect: () => void actions.setStatus(task, "Todo") }
                : { id: "complete", label: "Mark complete", icon: <Check size={14} />, disabled: !actions.canManage, onSelect: () => void actions.setStatus(task, "Done") },
              ...(actions.promote && isHistoricalSourceAction(task)
                ? [{ id: "promote", label: "Make current", icon: <ArrowUpRight size={14} />, disabled: !actions.canManage, onSelect: () => void actions.promote?.(task) }]
                : []),
            ],
          },
          ...statusMenuSections(task, actions),
          {
            id: "danger",
            items: [{ id: "delete", label: "Delete", icon: <Trash2 size={14} />, destructive: true, disabled: !actions.canManage, onSelect: () => void actions.remove(task) }],
          },
        ]}
      />
    </Isolated>
  );
}
