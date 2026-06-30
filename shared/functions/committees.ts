/**
 * PORTABLE FUNCTIONS: the committees domain
 * (list / get / detail / create / update / remove / addMember / removeMember).
 *
 * Reads/writes the `committees` table (plus `committeeMembers`, `meetings`,
 * `tasks`, `goals`, `activity`) over `ctx.db`. Each handler runs unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function committeesListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("committees")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function committeeGetPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function committeeDetailPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const committee = await ctx.db.get(id);
  if (!committee) return null;
  const [members, meetings, tasks, goals] = await Promise.all([
    ctx.db
      .query("committeeMembers")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect(),
    ctx.db
      .query("meetings")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect(),
    ctx.db
      .query("tasks")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect(),
    ctx.db
      .query("goals")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect(),
  ]);
  return { committee, members, meetings, tasks, goals };
}

export async function committeeCreatePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    name: string;
    description?: string;
    mission?: string;
    cadence: string;
    cadenceNotes?: string;
    chairDirectorId?: string;
    color: string;
  },
) {
  const id = await ctx.db.insert("committees", {
    ...args,
    status: "Active",
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: "You",
    entityType: "committee",
    entityId: id,
    action: "created",
    summary: `Created committee "${args.name}"`,
    createdAtISO: new Date().toISOString(),
  });
  return id;
}

export async function committeeUpdatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      name?: string;
      description?: string;
      mission?: string;
      cadence?: string;
      cadenceNotes?: string;
      nextMeetingAt?: string;
      chairDirectorId?: string;
      color?: string;
      status?: string;
    };
  },
) {
  await ctx.db.patch(id, patch);
}

export async function committeeRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const members = await ctx.db
    .query("committeeMembers")
    .withIndex("by_committee", (q) => q.eq("committeeId", id))
    .collect();
  for (const m of members) await ctx.db.delete(m._id);
  await ctx.db.delete(id);
}

export async function committeeAddMemberPortable(
  ctx: PortableMutationCtx,
  args: {
    committeeId: string;
    societyId: string;
    name: string;
    email?: string;
    role: string;
    directorId?: string;
    memberId?: string;
  },
) {
  return ctx.db.insert("committeeMembers", {
    ...args,
    joinedAt: new Date().toISOString().slice(0, 10),
  });
}

export async function committeeRemoveMemberPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
