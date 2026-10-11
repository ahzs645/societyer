/**
 * A task's checklist: small steps that belong to one task and are ticked off
 * in place (no owner or due date of their own; a step that needs one becomes
 * its own task).
 */
export type TaskChecklistItem = { id: string; title: string; done: boolean };

export const TASK_CHECKLIST_MAX_ITEMS = 100;
export const TASK_CHECKLIST_MAX_TITLE = 300;

/** Trim titles, drop empty steps and reject oversized or malformed lists. */
export function normalizeTaskChecklist(items: readonly unknown[]): TaskChecklistItem[] {
  if (items.length > TASK_CHECKLIST_MAX_ITEMS) throw new Error(`A checklist can hold at most ${TASK_CHECKLIST_MAX_ITEMS} steps.`);
  const seen = new Set<string>();
  const result: TaskChecklistItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") throw new Error("Each checklist step needs an id, title and done flag.");
    const { id, title, done } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim() || id.length > 64) throw new Error("Each checklist step needs a short id.");
    if (typeof title !== "string") throw new Error("Each checklist step needs a title.");
    if (typeof done !== "boolean") throw new Error("Each checklist step needs a done flag.");
    const trimmed = title.trim();
    if (!trimmed) continue;
    if (trimmed.length > TASK_CHECKLIST_MAX_TITLE) throw new Error(`Checklist steps are limited to ${TASK_CHECKLIST_MAX_TITLE} characters.`);
    if (seen.has(id)) throw new Error("Checklist step ids must be unique.");
    seen.add(id);
    result.push({ id, title: trimmed, done });
  }
  return result;
}

export function taskChecklistProgress(items: readonly TaskChecklistItem[] | undefined) {
  const total = items?.length ?? 0;
  const done = items?.filter((item) => item.done).length ?? 0;
  return { done, total };
}

export function newTaskChecklistId() {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
