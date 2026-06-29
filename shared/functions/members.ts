/**
 * PORTABLE FUNCTIONS: the members domain (list / get / create / update / remove).
 *
 * Straight CRUD over `ctx.db` — the common-case shape most of the remaining ~145
 * modules follow. One handler runs on hosted Convex, the local Dexie runtime, and
 * the convex-test oracle. (`members:merge` stays on Convex for now: it rewires
 * foreign keys across ~20 tables and gates on a Director role.)
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export interface MemberCreateArgs {
  societyId: string;
  firstName: string;
  lastName: string;
  email?: string;
  aliases?: string[];
  phone?: string;
  address?: string;
  membershipClass: string;
  status: string;
  joinedAt: string;
  votingRights: boolean;
  notes?: string;
}

export interface MemberPatch {
  firstName?: string;
  lastName?: string;
  email?: string;
  aliases?: string[];
  phone?: string;
  address?: string;
  membershipClass?: string;
  status?: string;
  joinedAt?: string;
  leftAt?: string;
  votingRights?: boolean;
  notes?: string;
}

export async function membersList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

export async function memberGet(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function memberCreate(ctx: PortableMutationCtx, args: MemberCreateArgs): Promise<string> {
  return ctx.db.insert("members", args);
}

export async function memberUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: MemberPatch }): Promise<void> {
  await ctx.db.patch(id, patch);
}

export async function memberRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
