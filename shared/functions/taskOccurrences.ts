/**
 * PORTABLE HELPER: the next occurrence of a repeating task.
 *
 * Called by `taskUpdate` when a task is marked Done. It creates the next task
 * once: the completed task records the new one in `recurrenceNextTaskId`, so
 * reopening and completing it again creates nothing more. Cancelling never
 * calls it, and nothing is created past the rule's end date.
 */
import type { PortableDoc, PortableMutationCtx } from "../portable/ctx";
import { normalizeTaskChecklist, type TaskChecklistItem } from "../taskChecklist";
import { isIsoDay, isTaskRecurrenceFrequency, nextTaskOccurrence, type TaskRecurrence } from "../taskRecurrence";
import { organizationTodayForTasks } from "./taskNotifications";

/**
 * What the next occurrence carries over: wording, priority, owners, committee,
 * tags, every "Linked to" slot, and the minutes provenance, so a task made
 * from an in-camera section stays in camera in every occurrence.
 */
const COPIED_FIELDS = [
  "title", "description", "priority",
  "assignee", "assigneePersonId", "responsibleUserIds",
  "committeeId", "tags",
  "meetingId", "agendaItemId", "goalId", "filingId", "workflowId", "documentId", "commitmentId", "eventId",
  "minutesSectionIndex", "minutesSectionTitle", "inCamera",
] as const;

function recurrenceOf(value: unknown): TaskRecurrence | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TaskRecurrence>;
  if (!isTaskRecurrenceFrequency(row.frequency) || typeof row.interval !== "number") return null;
  return {
    frequency: row.frequency,
    interval: row.interval,
    ...(typeof row.until === "string" ? { until: row.until } : {}),
    ...(typeof row.anchorDay === "number" ? { anchorDay: row.anchorDay } : {}),
  };
}

function uncheckedChecklist(value: unknown): TaskChecklistItem[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  return normalizeTaskChecklist(value.map((item: TaskChecklistItem) => ({ ...item, done: false })));
}

/**
 * Create the next occurrence of `task` (as saved, already Done) and return its
 * id, or null when there is none to create: no rule, no due date, already
 * created, or past the end date.
 */
export async function createNextTaskOccurrence(ctx: PortableMutationCtx, task: PortableDoc, nowISO = new Date().toISOString()): Promise<string | null> {
  if (task.recurrenceNextTaskId) return null;
  const rule = recurrenceOf(task.recurrence);
  if (!rule || !isIsoDay(task.dueDate)) return null;
  const society = await ctx.db.get(String(task.societyId), "societies");
  const today = organizationTodayForTasks(society, nowISO);
  // A start date moves with the due date, keeping the same distance before it.
  const next = nextTaskOccurrence({ dueDate: task.dueDate, ...(isIsoDay(task.startDate) ? { startDate: task.startDate } : {}) }, rule, { today });
  if (!next) return null;
  // A repeating sub-task stays under its parent while the parent exists.
  const parent = typeof task.parentTaskId === "string" ? await ctx.db.get(task.parentTaskId, "tasks") : null;
  const copied: Record<string, unknown> = {};
  for (const field of COPIED_FIELDS) if (task[field] !== undefined) copied[field] = task[field];
  const checklist = uncheckedChecklist(task.checklist);
  const id = await ctx.db.insert("tasks", {
    ...copied,
    societyId: task.societyId,
    tags: Array.isArray(task.tags) ? task.tags : [],
    status: "Todo",
    dueDate: next.dueDate,
    ...(next.startDate ? { startDate: next.startDate } : {}),
    ...(parent && parent.societyId === task.societyId ? { parentTaskId: parent._id } : {}),
    ...(checklist ? { checklist } : {}),
    recurrence: rule,
    recurrencePreviousTaskId: task._id,
    createdAtISO: nowISO,
  });
  // Integration hook (attachments): copy the completed task's `taskAttachments` rows to `id` here.
  await ctx.db.patch(String(task._id), { recurrenceNextTaskId: id });
  await ctx.db.insert("activity", {
    societyId: task.societyId,
    actor: "You",
    entityType: "task",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action: "created",
    summary: `Created the next "${String(task.title)}", due ${next.dueDate}`,
    createdAtISO: nowISO,
  });
  return id;
}
