/**
 * Task status vocabulary and historical-source-action helpers (WP-H, P2–P5, B6).
 *
 * Historical source actions are action lines copied from old minutes. They are
 * evidence of what a meeting asked for, not current obligations, so they never
 * count as open work and are listed separately from operational tasks.
 */
import { normalizeSearchName } from "./peopleDirectory";

export const TASK_STATUSES = ["Todo", "InProgress", "Blocked", "Done", "Unknown", "Cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Statuses offered when creating a task (Unknown is for imported history). */
export const TASK_CREATE_STATUSES = ["Todo", "InProgress", "Blocked", "Done"] as const;
export const OPEN_TASK_STATUSES = ["Todo", "InProgress", "Blocked"] as const;

export const TASK_STATUS_LABELS: Record<string, string> = {
  Todo: "To do",
  InProgress: "In progress",
  Blocked: "Blocked",
  Done: "Done",
  Unknown: "Unknown (from source)",
  Cancelled: "Cancelled",
};

export function taskStatusLabel(status: string) {
  return TASK_STATUS_LABELS[status] ?? status;
}

export const HISTORICAL_ACTION_TAG = "historical-source-action";
export const PROMOTED_ACTION_TAG = "promoted-from-source-action";

export function isHistoricalSourceAction(task: { tags?: readonly string[] | null } | Record<string, any>) {
  return Boolean((task as any).tags?.includes?.(HISTORICAL_ACTION_TAG));
}

/** True for work that should appear in "open tasks" counts and lists. */
export function isOpenOperationalTask(task: { status: string; tags?: readonly string[] | null } | Record<string, any>) {
  return (OPEN_TASK_STATUSES as readonly string[]).includes((task as any).status) && !isHistoricalSourceAction(task);
}

/** Normalized wording used to fold carried-forward duplicates of one action. */
export function actionTitleKey(title: string) {
  return normalizeSearchName(
    title
      .replace(/^\s*(?:action(?: item)?|review historical action)\s*[:\-–]\s*/i, "")
      .replace(/\s*\((?:carried(?: forward)?|ongoing|in progress|done|complete[d]?)\)\s*$/i, ""),
  );
}

/**
 * The owner named at the start of a minutes action line:
 * "Kim to contact …" → "Kim"; "Gail and Deanna will …" → "Gail and Deanna".
 */
export function sourceAssigneeFromTitle(title: string): string | undefined {
  const text = title.replace(/^\s*(?:action(?: item)?|review historical action)\s*[:\-–]\s*/i, "").trim();
  const match = text.match(/^((?:[A-Z][\w'’.-]*)(?:\s+[A-Z][\w'’.-]*)?(?:\s*(?:,|and|&|\/)\s*[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*)?)*)\s+(?:to|will|shall|should|is to|are to|agreed to|volunteered to)\b/);
  if (!match) return undefined;
  const owner = match[1].trim();
  if (/^(?:The|All|Everyone|Staff|Committee|Board|Members?|Secretariat|Executive|Chair|Group|We|They|It)$/i.test(owner)) return owner;
  return owner;
}

/** Split a source assignee into individual names ("Gail and Deanna" → ["Gail", "Deanna"]). */
export function sourceAssigneeNames(assignee: string) {
  return assignee.split(/\s*(?:,|\band\b|&|\/)\s*/i).map((name) => name.trim()).filter(Boolean);
}
