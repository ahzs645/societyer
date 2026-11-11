/**
 * PORTABLE HELPERS: notifications about tasks (assigned to you, due soon,
 * overdue). Each one is a row addressed to one person (`userId`), so only that
 * person sees it, and their per-kind switches decide whether it reaches the
 * bell and the daily digest (`shared/notificationCatalog.ts`).
 *
 * - Assigned: raised by task create/update when a user is added to
 *   `responsibleUserIds`, never to the person who made the change.
 * - Due soon / overdue: raised by the daily alert scan (`scanSocietyAlerts`)
 *   for open operational tasks, once per due date each. The due date a task
 *   was last alerted for is kept on the task (`dueAlertsSent`), so moving the
 *   due date re-arms both alerts.
 *
 * In-camera tasks: a recipient whose role can't read in-camera material gets
 * the same "In-camera action" title the task list shows them.
 */
import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { IN_CAMERA_ACCESS_PERMISSION, IN_CAMERA_TASK_TITLE, isInCameraTask, type InCameraIndex } from "../minutesPrivacy";
import { OPEN_TASK_STATUSES, isOpenOperationalTask } from "../taskStatus";
import { addIsoDays, isIsoDay } from "../taskRecurrence";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import { inCameraIndex } from "./minutesPrivacy";
import { hasPermission } from "./permissions";

export const TASK_NOTIFICATION_KINDS = {
  assigned: "task_assigned",
  dueSoon: "task_due_soon",
  overdue: "task_overdue",
} as const;

/** Opens the task's side panel on the Tasks page. */
export function taskNotificationHref(taskId: string) {
  return `/app/tasks?record=${encodeURIComponent(taskId)}`;
}

/** The due date each alert last went out for. Stored on the task. */
export type TaskDueAlertsSent = { dueSoonFor?: string; overdueFor?: string };

type Recipient = { _id: string; role: string };

/**
 * The people a task notification may go to: users of the same workspace who
 * are active and whose role can read tasks. Ids from another workspace, or
 * that no longer exist, are dropped.
 */
async function taskRecipients(ctx: PortableQueryCtx, societyId: string, userIds: readonly string[]): Promise<Recipient[]> {
  const out: Recipient[] = [];
  for (const id of new Set(userIds)) {
    const user = await ctx.db.get(id, "users");
    if (!user || user.societyId !== societyId) continue;
    if (user.status && user.status !== "Active") continue;
    const role = String(user.role ?? "");
    if (!hasPermission(role, "tasks:read")) continue;
    out.push({ _id: user._id, role });
  }
  return out;
}

/** Builds each recipient's view of the task title; the in-camera index loads only when needed. */
function titleFor(ctx: PortableQueryCtx, task: PortableDoc) {
  let index: Promise<InCameraIndex> | undefined;
  return async (recipient: Recipient) => {
    if (hasPermission(recipient.role, IN_CAMERA_ACCESS_PERMISSION)) return String(task.title);
    index ??= inCameraIndex(ctx, String(task.societyId));
    return isInCameraTask(task, await index) ? IN_CAMERA_TASK_TITLE : String(task.title);
  };
}

function userIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Tell people newly made responsible for a task. `previousUserIds` is who was
 * responsible before the change (empty on create). Only open operational work
 * notifies: imported history, Done and Cancelled tasks never do.
 */
export async function notifyTaskAssignees(
  ctx: PortableMutationCtx,
  task: PortableDoc,
  previousUserIds: readonly string[],
  actorUserId: string | undefined,
  nowISO = new Date().toISOString(),
): Promise<number> {
  if (!isOpenOperationalTask(task)) return 0;
  const before = new Set(previousUserIds);
  const added = userIdsOf(task.responsibleUserIds).filter((id) => !before.has(id) && id !== actorUserId);
  if (!added.length) return 0;
  const societyId = String(task.societyId);
  const recipients = await taskRecipients(ctx, societyId, added);
  if (!recipients.length) return 0;
  const actor = actorUserId ? await ctx.db.get(actorUserId, "users") : null;
  const actorName = actor && actor.societyId === societyId && typeof actor.displayName === "string" ? actor.displayName.trim() : "";
  const due = isIsoDay(task.dueDate) ? ` Due ${task.dueDate}.` : "";
  const title = titleFor(ctx, task);
  for (const recipient of recipients) {
    await ctx.db.insert("notifications", {
      societyId,
      userId: recipient._id,
      kind: TASK_NOTIFICATION_KINDS.assigned,
      severity: "info",
      title: `Assigned to you: ${await title(recipient)}`,
      body: `${actorName ? `${actorName} made you responsible for this task.` : "You are now responsible for this task."}${due}`,
      linkHref: taskNotificationHref(String(task._id)),
      createdAtISO: nowISO,
    });
  }
  return recipients.length;
}

/** Today in the organization's own time zone. */
export function organizationTodayForTasks(society: PortableDoc | null, nowISO: string) {
  return resolutionCalendarDate(nowISO, resolutionTimeZone(society)) ?? nowISO.slice(0, 10);
}

/**
 * The scan's task pass: for each open operational task with a due date and at
 * least one responsible user, raise "due soon" when the due date is within
 * `leadDays` of today, and "overdue" once it has passed, each once per due
 * date. A task first seen already overdue gets only the overdue alert.
 */
export async function scanTaskDueAlerts(
  ctx: PortableMutationCtx,
  societyId: string,
  nowMs: number,
  leadDays: number,
): Promise<{ created: number }> {
  const society = await ctx.db.get(societyId, "societies");
  const nowISO = new Date(nowMs).toISOString();
  const today = organizationTodayForTasks(society, nowISO);
  const horizon = addIsoDays(today, Math.max(0, Math.floor(leadDays)));
  const open = (await Promise.all(OPEN_TASK_STATUSES.map((status) =>
    ctx.db.query("tasks").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status)).collect(),
  ))).flat();
  let created = 0;
  for (const task of open) {
    if (task.societyId !== societyId || !isOpenOperationalTask(task) || !isIsoDay(task.dueDate)) continue;
    const dueDate = task.dueDate;
    const overdue = dueDate < today;
    if (!overdue && dueDate > horizon) continue;
    const sent: TaskDueAlertsSent = task.dueAlertsSent && typeof task.dueAlertsSent === "object" ? task.dueAlertsSent : {};
    if (overdue ? sent.overdueFor === dueDate : sent.dueSoonFor === dueDate) continue;
    const recipients = await taskRecipients(ctx, societyId, userIdsOf(task.responsibleUserIds));
    // Nobody to tell yet: leave the alert armed for whoever is assigned later.
    if (!recipients.length) continue;
    const title = titleFor(ctx, task);
    for (const recipient of recipients) {
      const shown = await title(recipient);
      await ctx.db.insert("notifications", {
        societyId,
        userId: recipient._id,
        kind: overdue ? TASK_NOTIFICATION_KINDS.overdue : TASK_NOTIFICATION_KINDS.dueSoon,
        severity: overdue ? "err" : "warn",
        title: overdue ? `Task overdue: ${shown}` : `Task due soon: ${shown}`,
        body: overdue ? `It was due ${dueDate}.` : dueDate === today ? "It is due today." : `It is due ${dueDate}.`,
        linkHref: taskNotificationHref(String(task._id)),
        createdAtISO: nowISO,
      });
      created++;
    }
    const next: TaskDueAlertsSent = overdue ? { ...sent, overdueFor: dueDate } : { ...sent, dueSoonFor: dueDate };
    await ctx.db.patch(task._id, { dueAlertsSent: next });
  }
  return { created };
}

/** The weekly summary's line about one person's own open tasks, if any are due or overdue. */
export async function weeklyTaskLine(
  ctx: PortableQueryCtx,
  societyId: string,
  userId: string,
  today: string,
  leadDays: number,
): Promise<string | null> {
  const horizon = addIsoDays(today, Math.max(0, Math.floor(leadDays)));
  let due = 0;
  let overdue = 0;
  for (const status of OPEN_TASK_STATUSES) {
    const rows = await ctx.db.query("tasks").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status)).collect();
    for (const task of rows) {
      if (!isOpenOperationalTask(task) || !isIsoDay(task.dueDate) || !userIdsOf(task.responsibleUserIds).includes(userId)) continue;
      if (task.dueDate < today) overdue++;
      else if (task.dueDate <= horizon) due++;
    }
  }
  if (!due && !overdue) return null;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (!due) return `${count(overdue, "of your tasks is", "of your tasks are")} overdue.`;
  return `${count(due, "of your tasks is", "of your tasks are")} due in the next ${count(leadDays, "day", "days")}${overdue ? `, ${overdue} overdue` : ""}.`;
}
