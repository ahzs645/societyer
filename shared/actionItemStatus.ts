/**
 * A12: minutes action-item status.
 *
 * `done: boolean` could not say "ongoing", "on hold" or "the source does not
 * say". Action items now carry an optional `status` from the same vocabulary as
 * `minutes.actionObservations`; `done` is kept for compatibility and is always
 * derived from the status when a status is present (completed ⇒ done).
 *
 * Pure module.
 */

export const ACTION_ITEM_STATUSES = ["unknown", "open", "in_progress", "ongoing", "on_hold", "completed", "cancelled"] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

export const ACTION_ITEM_STATUS_LABELS: Record<ActionItemStatus, string> = {
  unknown: "Not stated",
  open: "Open",
  in_progress: "In progress",
  ongoing: "Ongoing",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function isActionItemStatus(value: unknown): value is ActionItemStatus {
  return typeof value === "string" && (ACTION_ITEM_STATUSES as readonly string[]).includes(value);
}

/** The effective status: explicit status, else the legacy boolean. */
export function actionItemStatus(item: { status?: unknown; done?: unknown } | null | undefined): ActionItemStatus {
  if (isActionItemStatus(item?.status)) return item!.status as ActionItemStatus;
  return item?.done === true ? "completed" : "open";
}

/** Classify source wording ("Done", "ongoing", "carried forward") into a status. */
export function actionStatusFromSource(raw: unknown): ActionItemStatus {
  if (typeof raw === "boolean") return raw ? "completed" : "unknown";
  const text = String(raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!text) return "unknown";
  if (isActionItemStatus(text.replace(/ /g, "_"))) return text.replace(/ /g, "_") as ActionItemStatus;
  if (/^(?:done|complete|completed|closed|finished|resolved|yes|true|addressed)\b/.test(text)) return "completed";
  if (/^(?:cancel|cancelled|canceled|dropped|withdrawn|no longer)/.test(text)) return "cancelled";
  if (/^(?:on hold|paused|deferred|postponed)/.test(text)) return "on_hold";
  if (/^(?:in progress|underway|started|working)/.test(text)) return "in_progress";
  if (/^(?:ongoing|continuing|recurring|carried|carry forward|carried forward)/.test(text)) return "ongoing";
  if (/^(?:open|to do|todo|pending|new|not started|outstanding|no|false)\b/.test(text)) return "open";
  return "unknown";
}

/** Normalize an action item for storage: keep status, derive `done`. */
export function normalizeActionItemStatusFields<T extends { status?: unknown; done?: unknown }>(item: T): T & { done: boolean } {
  if (isActionItemStatus(item.status)) return { ...item, done: item.status === "completed" };
  if (item.status !== undefined && item.status !== null) throw new Error(`Invalid action item status: ${String(item.status)}`);
  const { status: _drop, ...rest } = item as any;
  return { ...rest, done: item.done === true } as T & { done: boolean };
}
