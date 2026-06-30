/**
 * PORTABLE FUNCTIONS: the PIPA training domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export interface PipaTrainingCreateArgs {
  societyId: string;
  participantName: string;
  role: string;
  participantEmail?: string;
  topic: string;
  completedAtISO: string;
  nextDueAtISO?: string;
  trainer?: string;
  notes?: string;
}

export interface PipaTrainingPatch {
  participantName?: string;
  role?: string;
  participantEmail?: string;
  topic?: string;
  completedAtISO?: string;
  nextDueAtISO?: string;
  trainer?: string;
  notes?: string;
}

export async function pipaTrainingList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("pipaTrainings")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function pipaTrainingCreate(ctx: PortableMutationCtx, args: PipaTrainingCreateArgs): Promise<string> {
  return ctx.db.insert("pipaTrainings", args);
}

export async function pipaTrainingUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: PipaTrainingPatch }): Promise<void> {
  await ctx.db.patch(id, patch);
}

export async function pipaTrainingRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
