/**
 * PORTABLE FUNCTIONS: the conflicts domain (list / forMeeting / create / resolve / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";

export interface ConflictCreateArgs {
  societyId: string;
  /** Optional since A1: representatives who are not `directors` rows declare
   *  through `personId` (people directory) or a plain `personName`. */
  directorId?: string;
  personId?: string;
  personName?: string;
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
  /** Stable link to the first-class motion the recusal applies to. */
  motionId?: string;
}

export async function conflictsListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("conflicts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function conflictsForMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  await requireOwnedRow(ctx, "meetings", meetingId);
  return ctx.db
    .query("conflicts")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
}

export async function conflictsCreatePortable(ctx: PortableMutationCtx, args: ConflictCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (!args.directorId && !args.personId && !String(args.personName ?? "").trim()) {
    throw new Error("A conflict declaration needs a director, a person, or a declarant name.");
  }
  if (args.directorId) await getOwned(ctx, "directors", args.directorId, args.societyId);
  if (args.personId) await getOwned(ctx, "peopleDirectory", args.personId, args.societyId);
  if (args.meetingId) await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  if (args.motionId) {
    const motion = await getOwned(ctx, "motions", args.motionId, args.societyId);
    if (args.meetingId && motion?.primaryMeetingId && String(motion.primaryMeetingId) !== String(args.meetingId)) {
      throw new Error("The linked motion belongs to a different meeting.");
    }
  }
  const personName = String(args.personName ?? "").trim() || undefined;
  return ctx.db.insert("conflicts", { ...args, personName });
}

export async function conflictsResolvePortable(ctx: PortableMutationCtx, { id, resolvedAt }: { id: string; resolvedAt: string }): Promise<void> {
  await requireOwnedRow(ctx, "conflicts", id);
  await ctx.db.patch(id, { resolvedAt });
}

export async function conflictsRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await requireOwnedRow(ctx, "conflicts", id);
  await ctx.db.delete(id);
}
