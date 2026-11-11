/**
 * Tasks in, timeline rows out. Pure, so it can be tested and so sub-tasks can
 * be nested later without touching the view (see `nestTaskRows`).
 */
import { groupTasks, type TaskGroupBy, type TaskRecord } from "../taskModel";
import { scheduleFromDates, taskSpan, type TaskSchedule, type TaskSpan } from "./timelineMath";

export const UNSCHEDULED_GROUP_KEY = "unscheduled";

export type TimelineGroupRow = {
  kind: "group";
  key: string;
  /** The key collapse state is stored under (`groupBy:key`). */
  toggleKey: string;
  label: string;
  count: number;
  collapsed: boolean;
  /** The group header follows the list's grouping; "Not scheduled" is the timeline's own. */
  variant: TaskGroupBy | "unscheduled";
};

export type TimelineTaskRow = {
  kind: "task";
  key: string;
  task: TaskRecord;
  schedule: TaskSchedule;
  span: TaskSpan;
  /** Indent level: 0, or 1 for a sub-task shown under its parent. */
  depth: number;
};

export type TimelineRow = TimelineGroupRow | TimelineTaskRow;

export type BuildTimelineRowsInput = {
  tasks: readonly TaskRecord[];
  groupBy: TaskGroupBy;
  /** Collapsed state of groups the user opened or closed (true = closed), keyed `groupBy:key`; others use their default. */
  toggled: Readonly<Record<string, boolean>>;
  /** Length of an open-ended bar at the current scale (`openEndDays`). */
  openDays: number;
  now?: Date;
};

/**
 * Scheduled tasks under the list's groups (empty groups are left out), in
 * date order, then a "Not scheduled" group at the bottom, closed until
 * opened. With no grouping there are no group headers above the scheduled
 * tasks.
 */
export function buildTimelineRows({ tasks, groupBy, toggled, openDays, now = new Date() }: BuildTimelineRowsInput): TimelineRow[] {
  const scheduled: TaskRecord[] = [];
  const unscheduled: TaskRecord[] = [];
  const schedules = new Map<string, TaskSchedule>();
  for (const task of tasks) {
    const schedule = scheduleFromDates(task.startDate, task.dueDate);
    schedules.set(String(task._id), schedule);
    (schedule.start === null && schedule.due === null ? unscheduled : scheduled).push(task);
  }
  const taskRows = (list: TaskRecord[]): TimelineTaskRow[] =>
    nestTaskRows(sortByDate(list, schedules)).map(({ task, depth }) => {
      const schedule = schedules.get(String(task._id)) ?? { start: null, due: null };
      return { kind: "task", key: String(task._id), task, schedule, span: taskSpan(schedule, openDays), depth };
    });

  const rows: TimelineRow[] = [];
  if (groupBy === "none") {
    rows.push(...taskRows(scheduled));
  } else {
    for (const group of groupTasks(scheduled, groupBy, now)) {
      if (group.tasks.length === 0) continue;
      const toggleKey = `${groupBy}:${group.key}`;
      const collapsed = toggled[toggleKey] ?? Boolean(group.collapsedByDefault);
      rows.push({ kind: "group", key: `group:${group.key}`, toggleKey, label: group.label, count: group.tasks.length, collapsed, variant: groupBy });
      if (!collapsed) rows.push(...taskRows(group.tasks));
    }
  }
  if (unscheduled.length > 0) {
    const toggleKey = `timeline:${UNSCHEDULED_GROUP_KEY}`;
    const collapsed = toggled[toggleKey] ?? true;
    rows.push({ kind: "group", key: `group:${UNSCHEDULED_GROUP_KEY}`, toggleKey, label: "Not scheduled", count: unscheduled.length, collapsed, variant: "unscheduled" });
    if (!collapsed) rows.push(...taskRows(unscheduled));
  }
  return rows;
}

/** Earliest first by start (or due) day, then due day; ties keep the list's order. */
function sortByDate(tasks: TaskRecord[], schedules: Map<string, TaskSchedule>): TaskRecord[] {
  const keyOf = (task: TaskRecord) => {
    const schedule = schedules.get(String(task._id));
    return [schedule?.start ?? schedule?.due ?? Infinity, schedule?.due ?? Infinity] as const;
  };
  return tasks
    .map((task, index) => ({ task, index, key: keyOf(task) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.index - b.index)
    .map(({ task }) => task);
}

/**
 * Sub-tasks sit under their parent (depth 1), in the list's date order, when
 * the parent is in the same list. A sub-task whose parent is in another group
 * or filtered out keeps its own row at depth 0.
 */
export function nestTaskRows(tasks: TaskRecord[]): { task: TaskRecord; depth: number }[] {
  const present = new Set(tasks.map((task) => String(task._id)));
  const children = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    const parentId = task.parentTaskId ? String(task.parentTaskId) : null;
    if (!parentId || !present.has(parentId)) continue;
    children.set(parentId, [...(children.get(parentId) ?? []), task]);
  }
  const rows: { task: TaskRecord; depth: number }[] = [];
  for (const task of tasks) {
    const parentId = task.parentTaskId ? String(task.parentTaskId) : null;
    if (parentId && present.has(parentId)) continue;
    rows.push({ task, depth: 0 });
    for (const child of children.get(String(task._id)) ?? []) rows.push({ task: child, depth: 1 });
  }
  return rows;
}
