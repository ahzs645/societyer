/**
 * PORTABLE FUNCTIONS: the tasks domain
 * (list / byCommittee / byGoal / byMeeting / create / update / remove).
 *
 * Reads/writes the `tasks` table (and logs to `activity`) over `ctx.db`. Each
 * handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function tasksList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("tasks")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function tasksByCommittee(ctx: PortableQueryCtx, { committeeId }: { committeeId: string }) {
  return ctx.db
    .query("tasks")
    .withIndex("by_committee", (q) => q.eq("committeeId", committeeId))
    .collect();
}

export async function tasksByGoal(ctx: PortableQueryCtx, { goalId }: { goalId: string }) {
  return ctx.db
    .query("tasks")
    .withIndex("by_goal", (q) => q.eq("goalId", goalId))
    .collect();
}

export async function tasksByMeeting(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  return ctx.db
    .query("tasks")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
}

export async function taskCreate(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    assignee?: string;
    responsibleUserIds?: string[];
    dueDate?: string;
    committeeId?: string;
    meetingId?: string;
    goalId?: string;
    filingId?: string;
    workflowId?: string;
    documentId?: string;
    commitmentId?: string;
    eventId?: string;
    tags: string[];
  },
): Promise<string> {
  const id = await ctx.db.insert("tasks", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: "You",
    entityType: "task",
    entityId: id,
    action: "created",
    summary: `Created task "${args.title}"`,
    createdAtISO: new Date().toISOString(),
  });
  return id;
}

export async function taskUpdate(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      assignee?: string;
      responsibleUserIds?: string[];
      dueDate?: string;
      committeeId?: string;
      meetingId?: string;
      goalId?: string;
      filingId?: string;
      workflowId?: string;
      documentId?: string;
      commitmentId?: string;
      eventId?: string;
      tags?: string[];
      completedAt?: string;
      completedByUserId?: string;
      completionNote?: string;
    };
  },
): Promise<void> {
  const task = await ctx.db.get(id);
  if (!task) return;
  const next = { ...patch };
  if (patch.status === "Done" && !task.completedAt) {
    next.completedAt = new Date().toISOString();
  }
  if (patch.status && patch.status !== "Done" && task.completedAt) {
    next.completedAt = undefined as any;
  }
  await ctx.db.patch(id, next);
  if (patch.status) {
    await ctx.db.insert("activity", {
      societyId: task.societyId,
      actor: "You",
      entityType: "task",
      entityId: id,
      action: patch.status === "Done" ? "completed" : "updated",
      summary: `${patch.status === "Done" ? "Completed" : "Moved"} task "${task.title}" → ${patch.status}`,
      createdAtISO: new Date().toISOString(),
    });
  }
}

export async function taskRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
