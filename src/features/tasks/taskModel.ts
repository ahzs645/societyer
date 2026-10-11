/**
 * Task view model shared by the Tasks list, board and drawer: the joined row
 * shape, due-date buckets, owners, primary links and grouping.
 */
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { OPEN_TASK_STATUSES, taskStatusLabel } from "../../../shared/taskStatus";
import type { TaskChecklistItem } from "../../../shared/taskChecklist";

export type TaskLinkKind = "meeting" | "goal" | "filing" | "workflow" | "document" | "commitment" | "event";

export type TaskRecord = Doc<"tasks"> & {
  _searchText: string;
  responsibleUserIdsLabel?: string;
  committeeIdLabel?: string;
  meetingIdLabel?: string;
  goalIdLabel?: string;
  filingIdLabel?: string;
  workflowIdLabel?: string;
  documentIdLabel?: string;
  commitmentIdLabel?: string;
  completedByUserIdLabel?: string;
  linkedTo: TaskLinkKind[];
  checklist?: TaskChecklistItem[];
};

/** Statuses in board/list order. Unknown and Cancelled only come from imported history. */
export const TASK_STATUS_ORDER = ["Todo", "InProgress", "Blocked", "Done", "Unknown", "Cancelled"] as const;
export const TASK_PRIORITY_ORDER = ["Urgent", "High", "Medium", "Low"] as const;

export function isOpenStatus(status: string) {
  return (OPEN_TASK_STATUSES as readonly string[]).includes(status);
}

export function isClosedStatus(status: string) {
  return status === "Done" || status === "Cancelled";
}

/* ---------------------------------------------------------------- dates */

const DAY = 86_400_000;

/** A due date is free text; only an ISO calendar day is scheduled. */
export function parseDueDay(value?: string | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isoDay(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export type DueTone = "overdue" | "soon" | "none";
export type DueInfo = { label: string; tone: DueTone; days: number | null; title: string };

/** "Today", "Tomorrow", "Fri", "Oct 4" — red when overdue, amber when due within a day. */
export function dueInfo(value: string | undefined | null, status: string, now = new Date()): DueInfo | null {
  if (!value?.trim()) return null;
  const day = parseDueDay(value);
  if (!day) return { label: value, tone: "none", days: null, title: `Due: ${value}` };
  const today = startOfToday(now);
  const days = Math.round((day.getTime() - today.getTime()) / DAY);
  const sameYear = day.getFullYear() === today.getFullYear();
  const long = day.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  let label = long;
  if (days === 0) label = "Today";
  else if (days === 1) label = "Tomorrow";
  else if (days === -1) label = "Yesterday";
  else if (days > 1 && days < 7) label = day.toLocaleDateString(undefined, { weekday: "short" });
  const open = !isClosedStatus(status) && status !== "Unknown";
  const tone: DueTone = open && days < 0 ? "overdue" : open && days <= 1 ? "soon" : "none";
  const full = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const title = tone === "overdue" ? `Overdue by ${-days} day${days === -1 ? "" : "s"} · ${full}` : `Due ${full}`;
  return { label, tone, days, title };
}

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";
export const DUE_BUCKETS: { key: DueBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "none", label: "No due date" },
];

export function dueBucket(task: Pick<TaskRecord, "dueDate" | "status">, now = new Date()): DueBucket {
  const day = parseDueDay(task.dueDate);
  if (!day) return "none";
  const days = Math.round((day.getTime() - startOfToday(now).getTime()) / DAY);
  if (days < 0) return isClosedStatus(task.status) || task.status === "Unknown" ? "later" : "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

/** Default due date for a task added into a due bucket. */
export function dueForBucket(bucket: DueBucket, now = new Date()): string | undefined {
  const today = startOfToday(now);
  if (bucket === "today" || bucket === "overdue") return isoDay(today);
  if (bucket === "week") return isoDay(addDays(today, 7));
  return undefined;
}

/* ---------------------------------------------------------------- people */

export function taskOwnerName(task: TaskRecord) {
  return task.responsibleUserIdsLabel || task.assignee || task.sourceAssignee || "";
}

export function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function isMine(task: TaskRecord, userId: Id<"users"> | string | null | undefined) {
  return Boolean(userId) && (task.responsibleUserIds ?? []).some((id) => String(id) === String(userId));
}

/* ---------------------------------------------------------------- links */

export type TaskPrimaryLink = { kind: "meeting" | "goal" | "filing" | "committee" | "document" | "commitment" | "workflow"; label: string };

/** The record a task belongs to, shown as a chip on rows and cards. */
export function taskPrimaryLink(task: TaskRecord): TaskPrimaryLink | null {
  const candidates: [TaskPrimaryLink["kind"], string | undefined][] = [
    ["meeting", task.meetingIdLabel],
    ["filing", task.filingIdLabel],
    ["goal", task.goalIdLabel],
    ["commitment", task.commitmentIdLabel],
    ["document", task.documentIdLabel],
    ["workflow", task.workflowIdLabel],
    ["committee", task.committeeIdLabel],
  ];
  const found = candidates.find(([, label]) => Boolean(label));
  return found ? { kind: found[0], label: found[1]! } : null;
}

/* ---------------------------------------------------------------- grouping */

export type TaskGroupBy = "status" | "priority" | "due" | "owner" | "none";
export const TASK_GROUP_OPTIONS: { value: TaskGroupBy; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "owner", label: "Owner" },
  { value: "none", label: "No grouping" },
];

export type TaskGroup = {
  key: string;
  label: string;
  /** Visual hint for the group header. */
  kind: TaskGroupBy;
  tasks: TaskRecord[];
  /** Fields a task added into this group starts with; null when adding is not offered. */
  defaults: Partial<{ status: string; priority: string; dueDate: string }> | null;
  /** Collapsed until opened (completed and imported groups). */
  collapsedByDefault?: boolean;
};

export function groupTasks(tasks: TaskRecord[], by: TaskGroupBy, now = new Date()): TaskGroup[] {
  if (by === "none") return [{ key: "all", label: "All tasks", kind: "none", tasks, defaults: {} }];
  if (by === "status") {
    return TASK_STATUS_ORDER.map((status) => ({
      key: status,
      label: taskStatusLabel(status),
      kind: "status" as const,
      tasks: tasks.filter((task) => task.status === status),
      defaults: status === "Unknown" || status === "Cancelled" ? null : { status },
      collapsedByDefault: status === "Done" || status === "Cancelled",
    })).filter((group) => group.tasks.length > 0 || group.key !== "Unknown" && group.key !== "Cancelled");
  }
  if (by === "priority") {
    const known = new Set<string>(TASK_PRIORITY_ORDER);
    const groups: TaskGroup[] = TASK_PRIORITY_ORDER.map((priority) => ({
      key: priority,
      label: priority,
      kind: "priority" as const,
      tasks: tasks.filter((task) => task.priority === priority),
      defaults: { priority },
    }));
    const other = tasks.filter((task) => !known.has(task.priority));
    if (other.length) groups.push({ key: "other", label: "No priority", kind: "priority", tasks: other, defaults: null });
    return groups;
  }
  if (by === "due") {
    return DUE_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      kind: "due" as const,
      tasks: tasks.filter((task) => dueBucket(task, now) === bucket.key),
      defaults: bucket.key === "overdue" ? null : { dueDate: dueForBucket(bucket.key, now) ?? "" },
    })).filter((group) => group.tasks.length > 0 || group.key === "today");
  }
  const byOwner = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    const owner = taskOwnerName(task) || "";
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), task]);
  }
  return [...byOwner.entries()]
    .sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1))
    .map(([owner, list]) => ({ key: owner || "none", label: owner || "No owner", kind: "owner" as const, tasks: list, defaults: owner ? null : {} }));
}

/* ---------------------------------------------------------------- quick scopes */

export type TaskScope = "all" | "mine" | "overdue" | "week" | "unowned";

export function taskInScope(task: TaskRecord, scope: TaskScope, userId: string | null | undefined, now = new Date()) {
  switch (scope) {
    case "mine":
      return isMine(task, userId);
    case "overdue":
      return dueBucket(task, now) === "overdue";
    case "week": {
      const bucket = dueBucket(task, now);
      return !isClosedStatus(task.status) && (bucket === "overdue" || bucket === "today" || bucket === "week");
    }
    case "unowned":
      return isOpenStatus(task.status) && !taskOwnerName(task);
    default:
      return true;
  }
}
