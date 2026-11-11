/**
 * Task start dates and sub-task rules shared by the server and the task form.
 *
 * A start date is a real calendar day ("YYYY-MM-DD"). A due date stays free
 * text for older tasks, so the two are compared only when both are calendar days.
 */

export const TASK_START_DATE_INVALID = "The start date must be a real date (YYYY-MM-DD).";
export const TASK_START_AFTER_DUE = "The start date can't be after the due date.";

/** "2026-02-30" is not a calendar day; "2026-02-28" is. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The message for a start/due pair that can't be saved, or null when it can. */
export function taskScheduleProblem(startDate: string | undefined | null, dueDate: string | undefined | null): string | null {
  if (startDate === undefined || startDate === null || startDate === "") return null;
  if (!isCalendarDay(startDate)) return TASK_START_DATE_INVALID;
  if (dueDate && isCalendarDay(dueDate) && startDate > dueDate) return TASK_START_AFTER_DUE;
  return null;
}

export function assertTaskSchedule(startDate: string | undefined | null, dueDate: string | undefined | null): void {
  const problem = taskScheduleProblem(startDate, dueDate);
  if (problem) throw new Error(problem);
}

/* ---------------------------------------------------------------- sub-tasks */

export const SUBTASK_SELF_PARENT = "A task can't be its own sub-task.";
export const SUBTASK_NESTED = "A sub-task can't have sub-tasks of its own.";
export const SUBTASK_HAS_CHILDREN = "This task has sub-tasks, so it can't become a sub-task.";
export const SUBTASK_HISTORICAL = "Historical actions can't have or be sub-tasks.";

type ParentCandidate = { _id: string; parentTaskId?: string | null; historical?: boolean };

/**
 * Why `taskId` (absent for a new task) can't sit under `parent`, or null when it can.
 * Sub-tasks are one level deep, so a task with sub-tasks never becomes one
 * and a sub-task never becomes a parent; that also rules out cycles.
 */
export function subtaskParentProblem(
  task: { id?: string; hasChildren: boolean; historical: boolean },
  parent: ParentCandidate,
): string | null {
  if (task.id !== undefined && task.id === parent._id) return SUBTASK_SELF_PARENT;
  if (task.historical || parent.historical) return SUBTASK_HISTORICAL;
  if (parent.parentTaskId) return SUBTASK_NESTED;
  if (task.hasChildren) return SUBTASK_HAS_CHILDREN;
  return null;
}

/** "2 of 5": done over sub-tasks that still count (cancelled ones don't). */
export function subtaskProgress(children: readonly { status: string }[]): { done: number; total: number } {
  const counted = children.filter((child) => child.status !== "Cancelled");
  return { done: counted.filter((child) => child.status === "Done").length, total: counted.length };
}
