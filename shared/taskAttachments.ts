/**
 * Things attached to a task (table `taskAttachments`): documents of the
 * workspace and procurement opportunities, any number of each. They say what
 * the work is about; the task's single "Linked to" slots keep saying where it
 * came from. Used by shared/functions/taskAttachments.ts, the task drawer and
 * the procurement reader.
 */
import { isOpportunityRecordKey } from "./procurementTriage";

export const TASK_ATTACHMENT_KINDS = ["document", "opportunity"] as const;
export type TaskAttachmentKind = (typeof TASK_ATTACHMENT_KINDS)[number];

export const isTaskAttachmentKind = (value: unknown): value is TaskAttachmentKind =>
  TASK_ATTACHMENT_KINDS.some((kind) => kind === value);

/** What a list shows without opening the thing: taken when it is attached. */
export type TaskAttachmentSnapshot = {
  title: string;
  /** The buyer, for an opportunity. */
  subtitle?: string;
  /** YYYY-MM-DD. */
  dueDate?: string;
  /** The date as the source wrote it ("Dec 4, 2026 2:00 PM (PST)"). */
  dueText?: string;
};

/** One attachment as the functions return it. */
export type TaskAttachment = TaskAttachmentSnapshot & {
  _id: string;
  taskId: string;
  kind: TaskAttachmentKind;
  refKey: string;
  attachedAtISO: string;
  attachedByName?: string;
};

/** A workspace's attachment of one kind, with the task it is on (procurement joins these onto its list). */
export type TaskAttachmentOnTask = TaskAttachment & { task: { title: string; status: string } };

const LIMITS = { title: 1000, subtitle: 500, dueText: 200 } as const;

/** A well-formed key for the kind: a non-empty id, or an opportunity's record key. */
export function isTaskAttachmentRefKey(kind: TaskAttachmentKind, refKey: string): boolean {
  if (kind === "opportunity") return isOpportunityRecordKey(refKey);
  return refKey.length > 0 && refKey.length <= 200;
}

/** The snapshot as stored: trimmed, bounded and with a real calendar day, or an error. */
export function normalizeTaskAttachmentSnapshot(snapshot: TaskAttachmentSnapshot): TaskAttachmentSnapshot {
  const title = snapshot.title.trim();
  const subtitle = snapshot.subtitle?.trim() ?? "";
  const dueText = snapshot.dueText?.trim() ?? "";
  const dueDate = snapshot.dueDate?.trim() ?? "";
  if (title.length > LIMITS.title || subtitle.length > LIMITS.subtitle || dueText.length > LIMITS.dueText)
    throw new Error("Invalid attachment.");
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("Invalid closing date.");
  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(dueText ? { dueText } : {}),
  };
}

/** Where an attached opportunity opens: its notice in the procurement reader. */
export const opportunityHref = (recordKey: string) => `/app/procurement-review?notice=${encodeURIComponent(recordKey)}`;

/** Where an attached document opens. */
export const documentHref = (documentId: string) => `/app/documents/${encodeURIComponent(documentId)}`;
