/**
 * Sub-task presentation helpers: the parent title and progress each row
 * carries, and the nested order of a list group. Pure, so they are tested
 * without a browser (scripts/check-task-structure.ts).
 */
import { subtaskProgress } from "../../../shared/taskSchedule";

type SubtaskSource = { _id: string; title: string; status: string; parentTaskId?: string | null };

export type SubtaskInfo = {
  /** The parent's title when this task is a sub-task and its parent exists. */
  parentTaskTitle?: string;
  /** Rollup for a parent: done over sub-tasks that count (not Cancelled). */
  subtaskProgress?: { done: number; total: number };
  /** Every sub-task, Cancelled included (what a delete takes with it). */
  subtaskCount?: number;
};

/** Adds parent titles and rollups, read across every task in the workspace. */
export function withSubtaskInfo<T extends SubtaskSource>(tasks: readonly T[]): Array<T & SubtaskInfo> {
  const byId = new Map(tasks.map((task) => [String(task._id), task]));
  const children = new Map<string, T[]>();
  for (const task of tasks) {
    const parentId = task.parentTaskId ? String(task.parentTaskId) : "";
    if (!parentId || !byId.has(parentId)) continue;
    children.set(parentId, [...(children.get(parentId) ?? []), task]);
  }
  return tasks.map((task) => {
    const parent = task.parentTaskId ? byId.get(String(task.parentTaskId)) : undefined;
    const kids = children.get(String(task._id));
    return {
      ...task,
      ...(parent ? { parentTaskTitle: parent.title } : {}),
      ...(kids?.length ? { subtaskProgress: subtaskProgress(kids), subtaskCount: kids.length } : {}),
    };
  });
}

export type TaskListEntry<T> = {
  task: T;
  /** 1 for a sub-task shown under its parent. */
  depth: 0 | 1;
  /** Sub-tasks nested under this row in the same group. */
  nested: number;
  /** Shown on a sub-task whose parent is not in the same group. */
  parentHint?: string;
};

/**
 * A group's rows in display order: each sub-task sits right under its parent
 * when the parent is in the same group; otherwise it stays in place on its
 * own with a hint naming the parent. `collapsed` parents hide their nested rows.
 */
export function nestTasks<T extends SubtaskSource & SubtaskInfo>(tasks: readonly T[], collapsed: ReadonlySet<string> = new Set()): TaskListEntry<T>[] {
  const ids = new Set(tasks.map((task) => String(task._id)));
  const nestedUnder = new Map<string, T[]>();
  for (const task of tasks) {
    const parentId = task.parentTaskId ? String(task.parentTaskId) : "";
    if (parentId && parentId !== String(task._id) && ids.has(parentId)) nestedUnder.set(parentId, [...(nestedUnder.get(parentId) ?? []), task]);
  }
  const entries: TaskListEntry<T>[] = [];
  for (const task of tasks) {
    const parentId = task.parentTaskId ? String(task.parentTaskId) : "";
    if (parentId && parentId !== String(task._id) && ids.has(parentId)) continue;
    const kids = nestedUnder.get(String(task._id)) ?? [];
    entries.push({ task, depth: 0, nested: kids.length, ...(parentId && task.parentTaskTitle ? { parentHint: task.parentTaskTitle } : {}) });
    if (collapsed.has(String(task._id))) continue;
    for (const kid of kids) entries.push({ task: kid, depth: 1, nested: 0 });
  }
  return entries;
}
