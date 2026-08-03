/**
 * PORTABLE FUNCTIONS: the directors domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

export interface DirectorCreateArgs {
  societyId: string;
  memberId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  aliases?: string[];
  position: string;
  isBCResident: boolean;
  termStart: string;
  termEnd?: string;
  consentOnFile: boolean;
  status: string;
  notes?: string;
}

export interface DirectorPatch {
  firstName?: string;
  lastName?: string;
  memberId?: string;
  email?: string;
  aliases?: string[];
  position?: string;
  isBCResident?: boolean;
  termStart?: string;
  termEnd?: string;
  consentOnFile?: boolean;
  resignedAt?: string;
  status?: string;
  notes?: string;
}

export async function directorsList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("directors")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function directorCreate(ctx: PortableMutationCtx, args: DirectorCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.memberId) await getOwned(ctx, "members", args.memberId, args.societyId);
  return ctx.db.insert("directors", args);
}

export async function directorUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: DirectorPatch }): Promise<void> {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await requireSocietyMembership(ctx, societyId);
  await getOwned(ctx, "directors", id, societyId);
  if (patch.memberId) await getOwned(ctx, "members", patch.memberId, societyId);
  await ctx.db.patch(id, patch);
}

export async function directorRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await requireSocietyMembership(ctx, societyId);
  await getOwned(ctx, "directors", id, societyId);
  await ctx.db.delete(id);
}
