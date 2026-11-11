/**
 * A task's schedule: an optional start date and an optional due date. The
 * start date is always a calendar day ("YYYY-MM-DD"); the due date is free
 * text and only scheduled when it is one. Shared by the server (taskCreate,
 * taskUpdate) and the Tasks timeline.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written "YYYY-MM-DD" (not "2026-02-30"). */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

/** Both dates are calendar days and the start falls after the due date. */
export function isStartAfterDue(startDate: unknown, dueDate: unknown): boolean {
  return isIsoDay(startDate) && isIsoDay(dueDate) && startDate > dueDate;
}

export const TASK_START_FORMAT_MESSAGE = "The start date must be a date (YYYY-MM-DD).";
export const TASK_START_AFTER_DUE_MESSAGE = "The start date can't be after the due date.";

/**
 * Throws when a start date is not a calendar day, or falls after the due
 * date. An empty start date counts as none.
 */
export function assertTaskSchedule(startDate: unknown, dueDate: unknown): void {
  if (startDate !== undefined && startDate !== null && startDate !== "" && !isIsoDay(startDate)) {
    throw new Error(TASK_START_FORMAT_MESSAGE);
  }
  if (isStartAfterDue(startDate, dueDate)) throw new Error(TASK_START_AFTER_DUE_MESSAGE);
}
