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
import { getOwned, requireSocietyMembership } from "./access";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("goals")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "goals");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("goals not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  return getOwned(ctx, "goals", id, candidate.societyId);
}

export async function byCommitteePortable(ctx: PortableQueryCtx, { committeeId }: { committeeId: string }) {
  const committee = await ctx.db.get(committeeId, "committees");
  if (!committee || typeof committee.societyId !== "string") throw new Error("committees not found.");
  await requireSocietyMembership(ctx, committee.societyId);
  await getOwned(ctx, "committees", committeeId, committee.societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  if (args.committeeId) await getOwned(ctx, "committees", args.committeeId, args.societyId);
  const id = await ctx.db.insert("goals", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: "You",
    entityType: "goal",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action: "created",
    summary: `Created goal "${args.title}"`,
    createdAtISO: new Date().toISOString(),
  });
  return id;
}

export async function updatePortable(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: GoalPatch }) {
  const candidate = await ctx.db.get(id, "goals");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("goals not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "goals", id, candidate.societyId);
  if (patch.committeeId) await getOwned(ctx, "committees", patch.committeeId, candidate.societyId);
  await ctx.db.patch(id, patch);
}

export async function toggleMilestonePortable(ctx: PortableMutationCtx, { id, index }: { id: string; index: number }) {
  const candidate = await ctx.db.get(id, "goals");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("goals not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const goal = await getOwned(ctx, "goals", id, candidate.societyId);
  const milestones = [...goal.milestones];
  milestones[index] = { ...milestones[index], done: !milestones[index].done };
  const pct = Math.round(
    (milestones.filter((m: GoalMilestone) => m.done).length / Math.max(milestones.length, 1)) * 100,
  );
  await ctx.db.patch(id, { milestones, progressPercent: pct });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "goals");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("goals not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "goals", id, candidate.societyId);
  await ctx.db.delete(id);
}
