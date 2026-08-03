/**
 * PORTABLE FUNCTIONS: the conflicts domain (list / forMeeting / create / resolve / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

export interface ConflictCreateArgs {
  societyId: string;
  directorId: string;
  declaredAt: string;
  contractOrMatter: string;
  natureOfInterest: string;
  abstainedFromVote: boolean;
  leftRoom: boolean;
  notes?: string;
  meetingId?: string;
  motionIndex?: number;
  /** Snapshot of the motion's text at declaration time — used to re-resolve
   *  the link after the positional motions array is reordered or edited. */
  motionText?: string;
}

export async function conflictsListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("conflicts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function conflictsForMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await getOwned(ctx, "meetings", meetingId, societyId);
  return ctx.db
    .query("conflicts")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
}

export async function conflictsCreatePortable(ctx: PortableMutationCtx, args: ConflictCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "directors", args.directorId, args.societyId);
  if (args.meetingId) await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  return ctx.db.insert("conflicts", args);
}

export async function conflictsResolvePortable(ctx: PortableMutationCtx, { id, resolvedAt }: { id: string; resolvedAt: string }): Promise<void> {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await getOwned(ctx, "conflicts", id, societyId);
  await ctx.db.patch(id, { resolvedAt });
}

export async function conflictsRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await getOwned(ctx, "conflicts", id, societyId);
  await ctx.db.delete(id);
}
