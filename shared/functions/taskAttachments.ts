/**
 * PORTABLE FUNCTIONS: things attached to a task (table `taskAttachments`,
 * shared/taskAttachments.ts): list a task's attachments, list a workspace's
 * attachments of one kind, attach, detach.
 *
 * Reading needs tasks:read and changing needs tasks:write (the action policy
 * checks both; attach and detach check again, since procurement's "Create
 * action item" calls `attachToTask` directly). A document must belong to the
 * workspace and be one the person may open; a document the reader may not
 * open is left out of every list. An opportunity needs the procurement review
 * module. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime and the convex-test oracle.
 */
import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { documentAccessPredicate, requireDocumentAccess } from "./documents";
import { tasksForReader } from "./minutesPrivacy";
import { MODULES_BY_KEY, normalizeModuleSettings } from "../../src/lib/modules";
import {
  isTaskAttachmentKind,
  isTaskAttachmentRefKey,
  normalizeTaskAttachmentSnapshot,
  type TaskAttachment,
  type TaskAttachmentKind,
  type TaskAttachmentOnTask,
  type TaskAttachmentSnapshot,
} from "../taskAttachments";

/** At most this many attachments of one kind are listed for a workspace. */
const KIND_LIST_LIMIT = 8000;

type AttachmentRow = PortableDoc & {
  societyId: string;
  taskId: string;
  kind: string;
  refKey: string;
  title: string;
  subtitle?: string;
  dueDate?: string;
  dueText?: string;
  attachedByName?: string;
  attachedAtISO: string;
};

function requireKind(kind: string): TaskAttachmentKind {
  if (!isTaskAttachmentKind(kind)) throw new Error("Invalid attachment.");
  return kind;
}

/** Opportunities belong to procurement review: the module must be on for the workspace. */
async function requireKindModule(ctx: PortableQueryCtx, societyId: string, kind: TaskAttachmentKind) {
  if (kind !== "opportunity") return;
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("Society not found.");
  const disabledModules = Array.isArray(society.disabledModules)
    ? society.disabledModules.filter((entry): entry is string => typeof entry === "string")
    : null;
  if (!normalizeModuleSettings({ disabledModules }).procurementReview)
    throw new Error(`${MODULES_BY_KEY.procurementReview.label} is disabled for this workspace.`);
}

/** The task, in the caller's workspace (membership checked). */
async function ownedTask(ctx: PortableQueryCtx, taskId: string) {
  const candidate = await ctx.db.get(taskId, "tasks");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("tasks not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  return getOwned(ctx, "tasks", taskId, candidate.societyId);
}

const shape = (row: AttachmentRow, title = row.title): TaskAttachment => ({
  _id: String(row._id),
  taskId: String(row.taskId),
  kind: requireKind(row.kind),
  refKey: row.refKey,
  title,
  ...(row.subtitle ? { subtitle: row.subtitle } : {}),
  ...(row.dueDate ? { dueDate: row.dueDate } : {}),
  ...(row.dueText ? { dueText: row.dueText } : {}),
  attachedAtISO: row.attachedAtISO,
  ...(row.attachedByName ? { attachedByName: row.attachedByName } : {}),
});

/**
 * Document attachments the reader may open, with the document's current
 * title; the rest (deleted, restricted, another workspace's) are left out.
 */
async function readableRows(ctx: PortableQueryCtx, societyId: string, rows: AttachmentRow[]) {
  const known = rows.filter((row) => isTaskAttachmentKind(row.kind));
  if (!known.some((row) => row.kind === "document")) return known.map((row) => ({ row, title: row.title }));
  const allows = await documentAccessPredicate(ctx, societyId);
  const read = await Promise.all(
    known.map(async (row) => {
      if (row.kind !== "document") return { row, title: row.title };
      const document = await ctx.db.get(row.refKey, "documents");
      if (!document || document.societyId !== societyId || !allows(document)) return null;
      return { row, title: typeof document.title === "string" && document.title.trim() ? document.title : row.title };
    }),
  );
  return read.filter((entry): entry is { row: AttachmentRow; title: string } => entry !== null);
}

/** A task's attachments, oldest first. A task withheld from the reader (in camera) shows none. */
export async function listForTask(ctx: PortableQueryCtx, { taskId }: { taskId: string }): Promise<TaskAttachment[]> {
  const task = await ownedTask(ctx, taskId);
  const [visible] = await tasksForReader(ctx, task.societyId, [task]);
  if (visible !== task) return [];
  const rows = await ctx.db
    .query<AttachmentRow>("taskAttachments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  const readable = await readableRows(ctx, task.societyId, rows.filter((row) => row.societyId === task.societyId));
  return readable
    .map(({ row, title }) => shape(row, title))
    .sort((a, b) => a.attachedAtISO.localeCompare(b.attachedAtISO) || a._id.localeCompare(b._id));
}

/**
 * The workspace's attachments of one kind, each with the task it is on (its
 * title and status as the reader may see them). Procurement joins the
 * opportunities onto its list in the browser. Attachments of deleted tasks are
 * left out.
 */
export async function listByKind(
  ctx: PortableQueryCtx,
  { societyId, kind }: { societyId: string; kind: string },
): Promise<TaskAttachmentOnTask[]> {
  await requireSocietyMembership(ctx, societyId);
  const checked = requireKind(kind);
  await requireKindModule(ctx, societyId, checked);
  const rows = await ctx.db
    .query<AttachmentRow>("taskAttachments")
    .withIndex("by_society", (q) => q.eq("societyId", societyId).eq("kind", checked))
    .take(KIND_LIST_LIMIT);
  const taskIds = [...new Set(rows.map((row) => String(row.taskId)))];
  const tasks = (await Promise.all(taskIds.map((id) => ctx.db.get(id, "tasks")))).filter(
    (task): task is PortableDoc => !!task && task.societyId === societyId,
  );
  const byId = new Map((await tasksForReader(ctx, societyId, tasks)).map((task) => [String(task._id), task]));
  const readable = await readableRows(ctx, societyId, rows.filter((row) => byId.has(String(row.taskId))));
  return readable.map(({ row, title }) => {
    const task = byId.get(String(row.taskId));
    return {
      ...shape(row, title),
      task: { title: String(task?.title ?? ""), status: String(task?.status ?? "") },
    };
  });
}

/**
 * Attach a thing to a task; attaching what is already there changes nothing
 * and returns the existing row. A document's title is read from the document;
 * an opportunity's facts come from the caller (the catalog may live outside
 * Convex). Logged to the task's activity.
 */
export async function attachToTask(
  ctx: PortableMutationCtx,
  args: { taskId: string; kind: string; refKey: string; snapshot?: TaskAttachmentSnapshot },
): Promise<{ attachmentId: string; created: boolean }> {
  const task = await ownedTask(ctx, args.taskId);
  const societyId = task.societyId;
  const member = await requirePermissionPortable(ctx, societyId, "tasks:write");
  const kind = requireKind(args.kind);
  if (!isTaskAttachmentRefKey(kind, args.refKey)) throw new Error("Invalid attachment.");
  await requireKindModule(ctx, societyId, kind);
  let snapshot: TaskAttachmentSnapshot;
  if (kind === "document") {
    const document = await getOwned(ctx, "documents", args.refKey, societyId);
    await requireDocumentAccess(ctx, args.refKey);
    snapshot = normalizeTaskAttachmentSnapshot({ title: String(document.title ?? "") || "Untitled document" });
  } else {
    if (!args.snapshot?.title.trim()) throw new Error("An opportunity needs its title.");
    snapshot = normalizeTaskAttachmentSnapshot(args.snapshot);
  }
  const existing = await ctx.db
    .query<AttachmentRow>("taskAttachments")
    .withIndex("by_task", (q) => q.eq("taskId", args.taskId).eq("kind", kind).eq("refKey", args.refKey))
    .first();
  if (existing) return { attachmentId: String(existing._id), created: false };
  const attachedByName = [member.displayName, member.name, member.email].find(
    (value): value is string => typeof value === "string" && !!value.trim(),
  );
  // A local workspace may have no users row for its holder; only a real row is referenced.
  const userRow = await ctx.db.get(String(member._id), "users");
  const now = new Date().toISOString();
  const attachmentId = await ctx.db.insert("taskAttachments", {
    societyId,
    taskId: args.taskId,
    kind,
    refKey: args.refKey,
    ...snapshot,
    ...(userRow ? { attachedByUserId: String(userRow._id) } : {}),
    ...(attachedByName ? { attachedByName: attachedByName.trim().slice(0, 200) } : {}),
    attachedAtISO: now,
  });
  await logActivity(ctx, task, "attached", kind === "document" ? `Attached a document to task "${task.title}"` : `Attached opportunity "${snapshot.title}" to task "${task.title}"`);
  return { attachmentId, created: true };
}

/** Take an attachment off its task. Logged to the task's activity. */
export async function detachFromTask(ctx: PortableMutationCtx, { id }: { id: string }): Promise<null> {
  const candidate = await ctx.db.get<AttachmentRow>(id, "taskAttachments");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("Attachment not found.");
  await requirePermissionPortable(ctx, candidate.societyId, "tasks:write");
  const row = await getOwned<AttachmentRow>(ctx, "taskAttachments", id, candidate.societyId);
  const task = await ctx.db.get(String(row.taskId), "tasks");
  await ctx.db.delete(id);
  if (task && task.societyId === row.societyId)
    await logActivity(ctx, task, "detached", row.kind === "opportunity" ? `Removed opportunity "${row.title}" from task "${task.title}"` : `Removed a document from task "${task.title}"`);
  return null;
}

/** A deleted task takes its attachments with it (taskRemove). */
export async function deleteTaskAttachments(ctx: PortableMutationCtx, taskId: string) {
  const rows = await ctx.db.query("taskAttachments").withIndex("by_task", (q) => q.eq("taskId", taskId)).collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

/**
 * The next occurrence of a repeating task keeps the documents the work needs.
 * Opportunities stay behind: a tender closes once, so it belongs to the
 * occurrence it was attached to.
 */
export async function copyDocumentAttachments(ctx: PortableMutationCtx, fromTaskId: string, toTaskId: string) {
  const rows = await ctx.db.query("taskAttachments").withIndex("by_task", (q) => q.eq("taskId", fromTaskId).eq("kind", "document")).collect();
  for (const row of rows) {
    const { _id: _unusedId, _creationTime: _unusedCreated, ...fields } = row;
    await ctx.db.insert("taskAttachments", { ...fields, taskId: toTaskId });
  }
}

async function logActivity(ctx: PortableMutationCtx, task: PortableDoc, action: string, summary: string) {
  await ctx.db.insert("activity", {
    societyId: task.societyId,
    actor: "You",
    entityType: "task",
    subjectId: task._id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: task._id,
    action,
    summary,
    createdAtISO: new Date().toISOString(),
  });
}
