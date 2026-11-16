/**
 * PORTABLE FUNCTIONS: the AI notes draft and the action items of a meeting
 * that keeps notes. Hosted Convex (convex/meetings.ts) and the local runtimes
 * run these unchanged.
 *
 * The person's own notes (`meetings.workingNotes`) are never written here:
 * the draft is stored beside them in `meetings.notesDraft`.
 */
import type { PortableMutationCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow } from "./access";
import { requirePermissionPortable } from "./permissions";
import { isNotesDraftTemplateId, normalizeNotesActionItems, normalizeNotesDraft } from "../ai/notesDraft";
import {
  isReplaceableSuggestion,
  mergeSuggestedActions,
  normalizeNoteActionItems,
  taskDraftFromNoteAction,
  type NoteActionItem,
} from "../meetingNoteActions";
import { taskCreate } from "./tasks";

const GENERATED_BY_MAX = 120;

/**
 * Saves a notes draft (from the hosted action or the on-device model) and
 * merges its suggested action items. The draft is untrusted model output, so
 * it is normalised again here, whatever the caller did.
 */
export async function saveNotesDraftPortable(
  ctx: PortableMutationCtx,
  args: {
    id: string;
    template: string;
    draft: unknown;
    generatedBy: string;
    usedNotes: boolean;
    usedTranscript: boolean;
  },
) {
  const meeting = await requireOwnedRow(ctx, "meetings", args.id);
  await requirePermissionPortable(ctx, String(meeting.societyId), "meetings:write");
  if (!isNotesDraftTemplateId(args.template)) throw new Error("Unknown notes template.");
  const empty = { template: args.template, summary: "", sections: [], decisions: [], openQuestions: [], actionItems: [] };
  const draft = normalizeNotesDraft(args.draft, empty);
  const suggestions = normalizeNotesActionItems((args.draft as { actionItems?: unknown } | null)?.actionItems) ?? [];
  if (!draft.summary && !draft.sections.length && !draft.decisions.length && !suggestions.length) {
    throw new Error("The draft came back empty. Add some notes or a transcript, then try again.");
  }
  const existing = (Array.isArray(meeting.noteActionItems) ? meeting.noteActionItems : []) as NoteActionItem[];
  const { items, added } = mergeSuggestedActions(existing, suggestions);
  await ctx.db.patch(args.id, {
    notesDraft: {
      template: draft.template,
      summary: draft.summary,
      sections: draft.sections,
      decisions: draft.decisions,
      openQuestions: draft.openQuestions,
      generatedAtISO: new Date().toISOString(),
      generatedBy: String(args.generatedBy ?? "").trim().slice(0, GENERATED_BY_MAX) || "AI",
      usedNotes: Boolean(args.usedNotes),
      usedTranscript: Boolean(args.usedTranscript),
    },
    noteActionItems: items,
  });
  return { actionItemsAdded: added, actionItems: items.length };
}

/** Removes the draft and the suggestions nobody acted on. */
export async function discardNotesDraftPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const meeting = await requireOwnedRow(ctx, "meetings", id);
  await requirePermissionPortable(ctx, String(meeting.societyId), "meetings:write");
  const existing = (Array.isArray(meeting.noteActionItems) ? meeting.noteActionItems : []) as NoteActionItem[];
  await ctx.db.patch(id, { notesDraft: undefined, noteActionItems: existing.filter((item) => !isReplaceableSuggestion(item)) });
  return null;
}

/** Replaces the action items list (add, edit, reorder, remove). */
export async function setNoteActionItemsPortable(ctx: PortableMutationCtx, { id, items }: { id: string; items: NoteActionItem[] }) {
  const meeting = await requireOwnedRow(ctx, "meetings", id);
  const societyId = String(meeting.societyId);
  await requirePermissionPortable(ctx, societyId, "meetings:write");
  const normalized = normalizeNoteActionItems(items);
  const previous = new Map(
    ((Array.isArray(meeting.noteActionItems) ? meeting.noteActionItems : []) as NoteActionItem[]).map((item) => [item.id, item]),
  );
  for (const item of normalized) {
    if (item.assigneePersonId) await getOwned(ctx, "peopleDirectory", item.assigneePersonId, societyId);
    if (item.goalId) await getOwned(ctx, "goals", item.goalId, societyId);
    if (item.committeeId) await getOwned(ctx, "committees", item.committeeId, societyId);
    if (item.taskId && item.taskId !== previous.get(item.id)?.taskId) await getOwned(ctx, "tasks", item.taskId, societyId);
  }
  await ctx.db.patch(id, { noteActionItems: normalized });
  return null;
}

/**
 * "Create task" on a notes action item: one task linked to the meeting, the
 * item's transcript time, its goal, committee and assignee, and the item
 * linked back to the task, atomically. Idempotent: an item that already has
 * a task returns it.
 */
export async function createTaskFromNoteActionPortable(
  ctx: PortableMutationCtx,
  { id, itemId, priority }: { id: string; itemId: string; priority?: string },
) {
  const meeting = await requireOwnedRow(ctx, "meetings", id);
  const societyId = String(meeting.societyId);
  await requirePermissionPortable(ctx, societyId, "meetings:write");
  await requirePermissionPortable(ctx, societyId, "tasks:write");
  const items = (Array.isArray(meeting.noteActionItems) ? meeting.noteActionItems : []) as NoteActionItem[];
  const item = items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("That action item is no longer on this meeting.");
  if (item.taskId && (await ctx.db.get(item.taskId))) return { taskId: item.taskId, created: false };
  const draft = taskDraftFromNoteAction(item, { meetingTitle: String(meeting.title ?? "") });
  const taskId = await taskCreate(ctx, {
    societyId,
    title: draft.title,
    description: draft.description,
    status: draft.status,
    priority: priority && ["Low", "Medium", "High", "Urgent"].includes(priority) ? priority : draft.priority,
    assignee: draft.assignee,
    assigneePersonId: draft.assigneePersonId,
    sourceAssignee: draft.sourceAssignee,
    dueDate: draft.dueDate,
    meetingId: id,
    ...(draft.transcriptRef ? { transcriptRef: draft.transcriptRef } : {}),
    ...(draft.goalId ? { goalId: draft.goalId } : {}),
    ...(draft.committeeId ? { committeeId: draft.committeeId } : {}),
    tags: ["meeting-notes"],
  });
  await ctx.db.patch(id, {
    noteActionItems: items.map((entry) => (entry.id === itemId ? { ...entry, taskId, origin: "manual" as const } : entry)),
  });
  return { taskId, created: true };
}
