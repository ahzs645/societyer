/**
 * PORTABLE FUNCTIONS: the members domain
 * (list / get / create / update / remove / merge).
 *
 * Straight CRUD over `ctx.db` — the common-case shape most of the remaining ~145
 * modules follow. One handler runs on hosted Convex, the local Dexie runtime, and
 * the convex-test oracle. `merge` rewires foreign keys across ~20 tables and
 * gates on a Director role through `requireRolePortable`; its FK scans use the
 * engine-agnostic `filter(predicate)` form of the portable contract.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";

// FK columns that point at a member. `merge` rewires each onto the surviving
// member before deleting the dropped rows.
const MEMBER_FK_REFS: Array<[string, string]> = [
  ["directors", "memberId"],
  ["boardRoleAssignments", "memberId"],
  ["boardRoleChanges", "memberId"],
  ["boardRoleChanges", "previousMemberId"],
  ["committeeMembers", "memberId"],
  ["memberCommunicationPrefs", "memberId"],
  ["communicationDeliveries", "memberId"],
  ["grantApplications", "memberId"],
  ["signatures", "memberId"],
  ["signatureProfiles", "memberId"],
  ["noticeDeliveries", "memberId"],
  ["memberSubscriptions", "memberId"],
  ["fundingSources", "linkedMemberId"],
  ["users", "memberId"],
  ["volunteers", "memberId"],
  ["volunteerApplications", "memberId"],
  ["pipaTrainings", "participantMemberId"],
  ["proxies", "grantorMemberId"],
  ["proxies", "proxyHolderMemberId"],
  ["electionEligibleVoters", "memberId"],
  ["electionNominations", "memberId"],
];

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

export async function memberMerge(
  ctx: PortableMutationCtx,
  { keepId, dropIds, patch, actingUserId }: {
    keepId: string;
    dropIds: string[];
    patch: MemberPatch;
    actingUserId?: string;
  },
) {
  const keep = await ctx.db.get(keepId);
  if (!keep) throw new Error("Member to keep not found.");

  // Merge permanently deletes records and rewires foreign keys — gate it on
  // Director. (Authorization is still client-asserted until server-side
  // identity lands; this brings members in line with volunteers/grants.)
  await requireRolePortable(ctx, { actingUserId, societyId: String(keep.societyId), required: "Director" });

  // Scope guard: never merge members across societies.
  const drops: any[] = [];
  for (const id of dropIds) {
    if (id === keepId) continue;
    const drop = await ctx.db.get(id);
    if (!drop) continue;
    if (String(drop.societyId) !== String(keep.societyId)) {
      throw new Error("Cannot merge members from different societies.");
    }
    drops.push(drop);
  }

  await ctx.db.patch(keepId, patch);

  // Rewire dependent foreign keys onto the surviving member, then delete.
  let rewired = 0;
  for (const drop of drops) {
    for (const [table, field] of MEMBER_FK_REFS) {
      // Rare admin-triggered merge; a scan over the FK column is acceptable
      // and there is no shared index across these heterogeneous tables. The
      // portable `filter` takes a JS predicate (collect-then-filter).
      const rows = await ctx.db
        .query(table)
        .filter((row: Record<string, any>) => row[field] === drop._id)
        .collect();
      for (const row of rows) {
        // Don't drag rows across societies (some tables, e.g. users, may be
        // shared); only rewire rows in the same society as the kept member.
        if (row.societyId !== undefined && String(row.societyId) !== String(keep.societyId)) {
          continue;
        }
        await ctx.db.patch(row._id, { [field]: keepId });
        rewired += 1;
      }
    }
    await ctx.db.delete(drop._id);
  }

  return { keepId, merged: drops.length, rewired };
}
