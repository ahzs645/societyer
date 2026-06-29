/**
 * PORTABLE FUNCTIONS: the goals domain
 * (list / get / byCommittee / create / update / toggleMilestone / remove).
 *
 * Straight CRUD over `ctx.db` with a couple of derived fields (creation
 * timestamps, an activity-log entry on create, and milestone-driven progress
 * recompute on toggle). Each handler runs unchanged on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("goals")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function byCommitteePortable(ctx: PortableQueryCtx, { committeeId }: { committeeId: string }) {
  return ctx.db
    .query("goals")
    .withIndex("by_committee", (q) => q.eq("committeeId", committeeId))
    .collect();
}

export interface GoalMilestone {
  title: string;
  done: boolean;
  dueDate?: string;
}

export interface GoalKeyResult {
  description: string;
  currentValue: number;
  targetValue: number;
  unit: string;
}

export interface GoalCreateArgs {
  societyId: string;
  committeeId?: string;
  title: string;
  description?: string;
  category: string;
  status: string;
  startDate: string;
  targetDate: string;
  progressPercent: number;
  ownerName?: string;
  milestones: GoalMilestone[];
  keyResults: GoalKeyResult[];
}

export interface GoalPatch {
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  startDate?: string;
  targetDate?: string;
  progressPercent?: number;
  ownerName?: string;
  milestones?: GoalMilestone[];
  keyResults?: GoalKeyResult[];
  committeeId?: string;
}

export async function createPortable(ctx: PortableMutationCtx, args: GoalCreateArgs) {
  const id = await ctx.db.insert("goals", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: "You",
    entityType: "goal",
    entityId: id,
    action: "created",
    summary: `Created goal "${args.title}"`,
    createdAtISO: new Date().toISOString(),
  });
  return id;
}

export async function updatePortable(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: GoalPatch }) {
  await ctx.db.patch(id, patch);
}

export async function toggleMilestonePortable(ctx: PortableMutationCtx, { id, index }: { id: string; index: number }) {
  const goal = await ctx.db.get(id);
  if (!goal) return;
  const milestones = [...goal.milestones];
  milestones[index] = { ...milestones[index], done: !milestones[index].done };
  const pct = Math.round(
    (milestones.filter((m: GoalMilestone) => m.done).length / Math.max(milestones.length, 1)) * 100,
  );
  await ctx.db.patch(id, { milestones, progressPercent: pct });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
