/**
 * PORTABLE FUNCTIONS: the invitations domain
 * (list / create / revoke / getByToken).
 *
 * Reads/writes the `invitations` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("invitations")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .collect();
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    email: string;
    role: string;
    invitedByUserId?: string;
  },
) {
  if (!args.email.trim()) throw new Error("Email is required");
  const token = `inv_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return ctx.db.insert("invitations", {
    ...args,
    email: args.email.trim().toLowerCase(),
    token,
    createdAtISO: new Date().toISOString(),
  });
}

export async function revokePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
}

export async function getByTokenPortable(ctx: PortableQueryCtx, { token }: { token: string }) {
  return ctx.db
    .query("invitations")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}
