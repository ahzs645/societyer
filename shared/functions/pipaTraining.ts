/**
 * PORTABLE FUNCTIONS: the PIPA training domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

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
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("pipaTrainings")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function pipaTrainingCreate(ctx: PortableMutationCtx, args: PipaTrainingCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  return ctx.db.insert("pipaTrainings", args);
}

export async function pipaTrainingUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: PipaTrainingPatch }): Promise<void> {
  const candidate = await ctx.db.get(id, "pipaTrainings");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("pipaTrainings not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "pipaTrainings", id, candidate.societyId);
  await ctx.db.patch(id, patch);
}

export async function pipaTrainingRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const candidate = await ctx.db.get(id, "pipaTrainings");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("pipaTrainings not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "pipaTrainings", id, candidate.societyId);
  await ctx.db.delete(id);
}
