/**
 * PORTABLE FUNCTIONS: the tasks domain
 * (list / byCommittee / byGoal / byMeeting / create / update / remove).
 *
 * Reads/writes the `tasks` table (and logs to `activity`) over `ctx.db`. Each
 * handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireSocietyMembership } from "./access";

export async function tasksList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("tasks")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function tasksByCommittee(ctx: PortableQueryCtx, { committeeId }: { committeeId: string }) {
  const committee = await ctx.db.get(committeeId, "committees");
  if (!committee || typeof committee.societyId !== "string") throw new Error("committees not found.");
  await requireSocietyMembership(ctx, committee.societyId);
  await getOwned(ctx, "committees", committeeId, committee.societyId);
  return ctx.db
    .query("tasks")
    .withIndex("by_committee", (q) => q.eq("committeeId", committeeId))
    .collect();
}

export async function tasksByGoal(ctx: PortableQueryCtx, { goalId }: { goalId: string }) {
  const goal = await ctx.db.get(goalId, "goals");
  if (!goal || typeof goal.societyId !== "string") throw new Error("goals not found.");
  await requireSocietyMembership(ctx, goal.societyId);
  await getOwned(ctx, "goals", goalId, goal.societyId);
  return ctx.db
    .query("tasks")
    .withIndex("by_goal", (q) => q.eq("goalId", goalId))
    .collect();
}

export async function tasksByMeeting(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  const meeting = await ctx.db.get(meetingId, "meetings");
  if (!meeting || typeof meeting.societyId !== "string") throw new Error("meetings not found.");
  await requireSocietyMembership(ctx, meeting.societyId);
  await getOwned(ctx, "meetings", meetingId, meeting.societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  if (args.committeeId) await getOwned(ctx, "committees", args.committeeId, args.societyId);
  if (args.meetingId) await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  if (args.goalId) await getOwned(ctx, "goals", args.goalId, args.societyId);
  if (args.filingId) await getOwned(ctx, "annualFilingLedger", args.filingId, args.societyId);
  if (args.workflowId) await getOwned(ctx, "workflows", args.workflowId, args.societyId);
  if (args.documentId) await getOwned(ctx, "documents", args.documentId, args.societyId);
  if (args.commitmentId) await getOwned(ctx, "commitments", args.commitmentId, args.societyId);
  if (args.eventId) await getOwned(ctx, "commitmentEvents", args.eventId, args.societyId);
  for (const userId of args.responsibleUserIds ?? []) {
    await getOwned(ctx, "users", userId, args.societyId);
  }
  const id = await ctx.db.insert("tasks", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: "You",
    entityType: "task",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
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
      clearMeetingId?: boolean;
    };
  },
): Promise<void> {
  const candidate = await ctx.db.get(id, "tasks");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("tasks not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const task = await getOwned(ctx, "tasks", id, candidate.societyId);
  if (patch.committeeId) await getOwned(ctx, "committees", patch.committeeId, candidate.societyId);
  if (patch.meetingId) await getOwned(ctx, "meetings", patch.meetingId, candidate.societyId);
  if (patch.goalId) await getOwned(ctx, "goals", patch.goalId, candidate.societyId);
  if (patch.filingId) await getOwned(ctx, "annualFilingLedger", patch.filingId, candidate.societyId);
  if (patch.workflowId) await getOwned(ctx, "workflows", patch.workflowId, candidate.societyId);
  if (patch.documentId) await getOwned(ctx, "documents", patch.documentId, candidate.societyId);
  if (patch.commitmentId) await getOwned(ctx, "commitments", patch.commitmentId, candidate.societyId);
  if (patch.eventId) await getOwned(ctx, "commitmentEvents", patch.eventId, candidate.societyId);
  for (const userId of patch.responsibleUserIds ?? []) {
    await getOwned(ctx, "users", userId, candidate.societyId);
  }
  const { clearMeetingId, ...rest } = patch;
  const next: Record<string, unknown> = { ...rest };
  // `undefined` fields are stripped from the wire, so unlinking arrives as an
  // explicit flag and is converted to an unset here.
  if (clearMeetingId) next.meetingId = undefined;
  if (patch.status === "Done" && !task.completedAt) {
    next.completedAt = new Date().toISOString();
  }
  if (patch.status === "Done" || patch.completedByUserId) {
    next.completedByUserId = await principalUserId(ctx, candidate.societyId);
  }
  if (patch.status && patch.status !== "Done" && task.completedAt) {
    next.completedAt = undefined;
    next.completedByUserId = undefined;
    next.completionNote = undefined;
  }
  await ctx.db.patch(id, next);
  if (patch.status) {
    await ctx.db.insert("activity", {
      societyId: task.societyId,
      actor: "You",
      entityType: "task",
      subjectId: id,
      // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
      entityId: id,
      action: patch.status === "Done" ? "completed" : "updated",
      summary: `${patch.status === "Done" ? "Completed" : "Moved"} task "${task.title}" → ${patch.status}`,
      createdAtISO: new Date().toISOString(),
    });
  }
}

export async function taskRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const candidate = await ctx.db.get(id, "tasks");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("tasks not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "tasks", id, candidate.societyId);
  await ctx.db.delete(id);
}
