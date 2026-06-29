/**
 * PORTABLE ACCESS CONTROL: role ranking + `requireRole`.
 *
 * `requireRolePortable` is a pure `ctx.db` reader (it only consults the `users`
 * table), so it runs unchanged on hosted Convex, the local Dexie runtime, and
 * the convex-test oracle. This is the seam that lets role-gated mutations be
 * ported to the portable contract: a portable handler calls
 * `requireRolePortable(ctx, ...)` directly, and the Convex `requireRole` wrapper
 * (convex/users.ts) delegates here so live and offline enforce the same rule.
 */

import type { PortableQueryCtx } from "../portable/ctx";

export const ROLES = ["Owner", "Admin", "Director", "Member", "Viewer"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  Owner: 100,
  Admin: 80,
  Director: 60,
  Member: 40,
  Viewer: 20,
};

export function canActAs(actual: Role | undefined | null, required: Role): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export async function requireRolePortable(
  ctx: PortableQueryCtx,
  args: { actingUserId?: string | null; societyId: string; required: Role },
): Promise<{ user: any | null }> {
  if (!args.actingUserId) {
    // Bootstrap: if the society has no users yet, allow the first action so an
    // Owner can be created. There's no admin to enforce against in that state;
    // refusing it strands the page (no actor → can't create the actor).
    const firstUser = await ctx.db
      .query("users")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .first();
    if (!firstUser) return { user: null };
    throw new Error(`Role ${args.required} required — no authenticated actor.`);
  }
  const user = await ctx.db.get(args.actingUserId);
  if (!user) throw new Error("Unknown user.");
  if (user.societyId !== args.societyId) throw new Error("User is not part of this society.");
  if (!canActAs(user.role as Role, args.required)) {
    // Second bootstrap: if NOBODY in the society has the required role, let
    // any user proceed so they can self-promote. Covers the case where a
    // society was seeded with only non-admin users (e.g. all "Member"s) and
    // is otherwise stranded — there's no admin to recover from.
    const peers = await ctx.db
      .query("users")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const hasQualifiedActor = peers.some((peer) => canActAs(peer.role as Role, args.required));
    if (!hasQualifiedActor) return { user };
    throw new Error(`Role ${args.required} required — you have ${user.role}.`);
  }
  return { user };
}
