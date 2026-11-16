/**
 * Action items on a meeting that keeps notes (`meetings.noteActionItems`).
 * Pure module, shared by the portable mutations and the Notes tab.
 *
 * They have the minutes action item shape (text, assignee, due date, status,
 * linked task, transcript time) plus a stable `id`, so the UI can edit one
 * without index races, and links to a goal and a committee that "Create task"
 * carries onto the task. AI-suggested items are marked `origin: "ai"` until
 * someone edits them; regenerating the notes draft replaces only those.
 */
import { actionItemStatus, ACTION_ITEM_STATUSES, type ActionItemStatus } from "./actionItemStatus";
import { isIsoDate, type NotesDraftActionItem } from "./ai/notesDraft";
import { taskDraftFromActionItem } from "./meetingActionTasks";
import { validateTranscriptRef, type TranscriptRef } from "./transcriptModel";

export type NoteActionItem = {
  id: string;
  text: string;
  assignee?: string;
  assigneePersonId?: string;
  dueDate?: string;
  done: boolean;
  status?: ActionItemStatus;
  taskId?: string;
  transcriptRef?: TranscriptRef;
  goalId?: string;
  committeeId?: string;
  origin?: "ai" | "manual";
};

export const NOTE_ACTION_ITEMS_MAX = 200;
export const NOTE_ACTION_TEXT_MAX = 500;
/** How long an action is assumed to be spoken around its transcript time. */
const SUGGESTED_REF_SPAN_SEC = 15;

export function newNoteActionId(): string {
  return `na_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** An untouched AI suggestion: replaced when the draft is regenerated. */
export function isReplaceableSuggestion(item: NoteActionItem): boolean {
  if (item.origin !== "ai" || item.taskId) return false;
  const status = actionItemStatus(item as any);
  return status === "open" || status === "unknown";
}

/**
 * Items after a (re)generated draft: everything people made or touched stays,
 * untouched suggestions are replaced by the new ones, and a suggestion that
 * repeats a kept item is dropped.
 */
export function mergeSuggestedActions(
  existing: readonly NoteActionItem[],
  suggestions: readonly NotesDraftActionItem[],
  makeId: () => string = newNoteActionId,
): { items: NoteActionItem[]; added: number } {
  const kept = existing.filter((item) => !isReplaceableSuggestion(item));
  const seen = new Set(kept.map((item) => key(item.text)));
  const added: NoteActionItem[] = [];
  for (const suggestion of suggestions) {
    const k = key(suggestion.text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    added.push({
      id: makeId(),
      text: suggestion.text.slice(0, NOTE_ACTION_TEXT_MAX),
      ...(suggestion.assignee ? { assignee: suggestion.assignee } : {}),
      ...(suggestion.dueDate ? { dueDate: suggestion.dueDate } : {}),
      ...(suggestion.atSec !== undefined ? { transcriptRef: { startSec: suggestion.atSec, endSec: suggestion.atSec + SUGGESTED_REF_SPAN_SEC } } : {}),
      done: false,
      status: "open",
      origin: "ai",
    });
  }
  const items = [...kept, ...added].slice(0, NOTE_ACTION_ITEMS_MAX);
  return { items, added: Math.max(0, items.length - kept.length) };
}

/** Checks and tidies items from a client. References are checked by the caller. */
export function normalizeNoteActionItems(items: readonly NoteActionItem[]): NoteActionItem[] {
  if (items.length > NOTE_ACTION_ITEMS_MAX) throw new Error(`A meeting can keep up to ${NOTE_ACTION_ITEMS_MAX} action items.`);
  const ids = new Set<string>();
  return items.map((item) => {
    const id = String(item.id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new Error("Each action item needs its own id.");
    ids.add(id);
    const text = String(item.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("An action item needs text.");
    if (text.length > NOTE_ACTION_TEXT_MAX) throw new Error(`Keep action items under ${NOTE_ACTION_TEXT_MAX} characters.`);
    if (item.dueDate !== undefined && item.dueDate !== "" && !isIsoDate(item.dueDate)) throw new Error("Due dates use YYYY-MM-DD.");
    if (item.status !== undefined && !(ACTION_ITEM_STATUSES as readonly string[]).includes(item.status)) throw new Error("Unknown action item status.");
    const status = item.status ?? (item.done ? "completed" : "open");
    const assignee = item.assignee?.replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      id,
      text,
      ...(assignee ? { assignee } : {}),
      ...(item.assigneePersonId ? { assigneePersonId: item.assigneePersonId } : {}),
      ...(item.dueDate ? { dueDate: item.dueDate } : {}),
      done: status === "completed",
      status,
      ...(item.taskId ? { taskId: item.taskId } : {}),
      ...(item.transcriptRef ? { transcriptRef: validateTranscriptRef(item.transcriptRef.startSec, item.transcriptRef.endSec) } : {}),
      ...(item.goalId ? { goalId: item.goalId } : {}),
      ...(item.committeeId ? { committeeId: item.committeeId } : {}),
      ...(item.origin ? { origin: item.origin } : {}),
    };
  });
}

/** Task fields for "Create task" on a notes action item. */
export function taskDraftFromNoteAction(item: NoteActionItem, context: { meetingTitle?: string } = {}) {
  const base = taskDraftFromActionItem(item, {});
  const description = [
    base.description && !base.description.startsWith("From the minutes") ? base.description : "",
    context.meetingTitle ? `From the meeting notes of ${context.meetingTitle}.` : "",
  ].filter(Boolean).join("\n\n");
  return {
    ...base,
    description: description || undefined,
    ...(item.goalId ? { goalId: item.goalId } : {}),
    ...(item.committeeId ? { committeeId: item.committeeId } : {}),
    ...(item.transcriptRef ? { transcriptRef: item.transcriptRef } : {}),
  };
}

/** Minutes action items for "Turn notes into minutes" (the minutes have no goal or committee links). */
export function minutesActionItemsFromNotes(items: readonly NoteActionItem[] | undefined) {
  return (items ?? []).map((item) => ({
    text: item.text,
    ...(item.assignee ? { assignee: item.assignee } : {}),
    ...(item.assigneePersonId ? { assigneePersonId: item.assigneePersonId } : {}),
    ...(item.dueDate ? { dueDate: item.dueDate } : {}),
    done: item.done,
    ...(item.status ? { status: item.status } : {}),
    ...(item.taskId ? { taskId: item.taskId } : {}),
    ...(item.transcriptRef ? { transcriptRef: item.transcriptRef } : {}),
  }));
}
