/**
 * Minutes action items ↔ tasks (A12, B6, ui-meetings "create task from
 * action"). Pure module.
 */
import { actionItemStatus, type ActionItemStatus } from "./actionItemStatus";
import { validateTranscriptRef, type TranscriptRef } from "./transcriptModel";

/** The task board status for an action's status. */
export function taskStatusForActionStatus(status: ActionItemStatus): string {
  switch (status) {
    case "completed": return "Done";
    case "in_progress":
    case "ongoing": return "InProgress";
    case "on_hold": return "Blocked";
    case "cancelled": return "Cancelled";
    case "unknown": return "Unknown";
    default: return "Todo";
  }
}

export type ActionItemLike = {
  text: string;
  assignee?: string;
  assigneePersonId?: string;
  dueDate?: string;
  done?: boolean;
  status?: string;
  sourceStatus?: string;
  taskId?: string;
  transcriptRef?: TranscriptRef;
};

/** Task fields for "Create task from action". */
export function taskDraftFromActionItem(item: ActionItemLike, context: { meetingTitle?: string; sectionTitle?: string } = {}) {
  const title = String(item.text ?? "").replace(/\s+/g, " ").trim();
  const shortTitle = title.length > 140 ? `${title.slice(0, 137).trimEnd()}…` : title;
  const status = actionItemStatus(item as any);
  const description = [
    title.length > 140 ? title : "",
    context.meetingTitle ? `From the minutes of ${context.meetingTitle}${context.sectionTitle ? ` — ${context.sectionTitle}` : ""}.` : "",
    item.sourceStatus ? `Status as written in the source: ${item.sourceStatus}.` : "",
  ].filter(Boolean).join("\n\n");
  let transcriptRef: TranscriptRef | undefined;
  if (item.transcriptRef) {
    try {
      transcriptRef = validateTranscriptRef(item.transcriptRef.startSec, item.transcriptRef.endSec);
    } catch {
      // Older minutes can contain a timestamp that tasks cannot store.
    }
  }
  return {
    title: shortTitle || "Action item",
    description: description || undefined,
    status: taskStatusForActionStatus(status),
    priority: "Medium",
    assignee: item.assignee?.trim() || undefined,
    assigneePersonId: item.assigneePersonId || undefined,
    sourceAssignee: item.assignee?.trim() || undefined,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.dueDate ?? "")) ? item.dueDate : undefined,
    ...(transcriptRef ? { transcriptRef } : {}),
  };
}
