/** Wire-safe task edits. Omission preserves a field; clearFields explicitly removes it. */
import { meetingFieldValuesMatch } from "./meetingConcurrency";

export const TASK_CLEARABLE_FIELDS = [
  "description", "assignee", "assigneePersonId", "dueDate", "committeeId", "goalId",
  "meetingId", "agendaItemId", "filingId", "workflowId", "documentId", "commitmentId",
  "eventId", "completionNote",
] as const;
export type TaskClearableField = (typeof TASK_CLEARABLE_FIELDS)[number];
export const TASK_EDITABLE_FIELDS = [
  "title", "status", "priority", "responsibleUserIds", "tags", "checklist", ...TASK_CLEARABLE_FIELDS,
] as const;
export type TaskEditBaseline = Partial<Record<(typeof TASK_EDITABLE_FIELDS)[number], unknown>>;
const clearable = new Set<string>(TASK_CLEARABLE_FIELDS);
const editable = new Set<string>(TASK_EDITABLE_FIELDS);

/** Validate even in the portable runtime, where Convex argument validators do not run. */
export function normalizedTaskPatch<T extends Record<string, unknown>>(patch: T): Record<string, unknown> {
  const { clearFields = [], clearMeetingId, clearAgendaItemId, clearAssigneePersonId, ...rest } = patch;
  if (!Array.isArray(clearFields) || clearFields.some((field) => typeof field !== "string" || !clearable.has(field))) {
    throw new Error("Invalid task field to clear.");
  }
  const clears = new Set<string>(clearFields);
  if (clearMeetingId) clears.add("meetingId");
  if (clearAgendaItemId) clears.add("agendaItemId");
  if (clearAssigneePersonId) clears.add("assigneePersonId");
  if (clears.has("meetingId")) clears.add("agendaItemId");
  for (const field of clears) {
    if (rest[field] !== undefined) throw new Error(`Cannot set and clear task field "${field}" together.`);
  }
  const next: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
  for (const field of clears) next[field] = undefined;
  return next;
}

/**
 * A draft stays tied to the version of the task it was started from, including
 * after recovery, so retrying it can never overwrite the newer record.
 */
export const TASK_EDIT_CONFLICT_MESSAGE =
  "This task changed since you opened it, so your edits were not saved. Your draft stays on this device, but it will keep being refused because it was started from the older version. Note the changes you want, discard the draft, then reopen the task and make them on the latest version.";

/** A null baseline value represents an absent optional field on the wire. */
export function taskEditBaseline(task: Record<string, unknown>): TaskEditBaseline {
  return Object.fromEntries(TASK_EDITABLE_FIELDS.map((field) => [field, task[field] ?? null]));
}
export function assertTaskEditBaseline(task: Record<string, unknown>, expected?: TaskEditBaseline): void {
  if (expected === undefined) return; // Older/inline callers remain compatible.
  if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).some((key) => !editable.has(key))) {
    throw new Error("Invalid task edit baseline.");
  }
  for (const [field, value] of Object.entries(expected)) {
    if (!meetingFieldValuesMatch(task[field] ?? null, value)) {
      throw new Error(TASK_EDIT_CONFLICT_MESSAGE);
    }
  }
}

export function taskOptionalPatch(form: Record<TaskClearableField, string>) {
  const clearFields: TaskClearableField[] = [];
  const values: Partial<Record<TaskClearableField, string>> = {};
  for (const field of TASK_CLEARABLE_FIELDS) {
    const value = field === "agendaItemId" && !form.meetingId ? "" : form[field];
    if (value) values[field] = value;
    else clearFields.push(field);
  }
  return { ...values, clearFields };
}
