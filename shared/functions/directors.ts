/**
 * PORTABLE FUNCTIONS: the directors domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

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
  return ctx.db
    .query("directors")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function directorCreate(ctx: PortableMutationCtx, args: DirectorCreateArgs): Promise<string> {
  return ctx.db.insert("directors", args);
}

export async function directorUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: DirectorPatch }): Promise<void> {
  await ctx.db.patch(id, patch);
}

export async function directorRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
