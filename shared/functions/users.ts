/**
 * PORTABLE FUNCTIONS: the users domain (list / get / getByEmail /
 * getByAuthSubject / resolveAuthSession / recordLogin).
 *
 * Pure `ctx.db` reads and writes over the `users`/`members` tables. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. Role-gated handlers (`upsert`/`setRole`/`remove`) stay on Convex —
 * they call `requireRole`, which is a server-side helper.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function usersList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("users")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function userGet(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function userGetByEmail(ctx: PortableQueryCtx, { email }: { email: string }) {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  return rows[0] ?? null;
}

export async function userGetByAuthSubject(ctx: PortableQueryCtx, { authSubject }: { authSubject: string }) {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
    .collect();
  return rows[0] ?? null;
}

export async function resolveAuthSessionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    authSubject: string;
    email: string;
    displayName: string;
    emailVerified: boolean;
  },
) {
  const [existingByAuth, members, users] = await Promise.all([
    ctx.db
      .query("users")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", args.authSubject))
      .collect(),
    ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect(),
    ctx.db
      .query("users")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect(),
  ]);

  const email = args.email.toLowerCase();
  const existing =
    existingByAuth.find((row) => row.societyId === args.societyId) ??
    users.find(
      (row) =>
        row.societyId === args.societyId &&
        row.email.toLowerCase() === email,
    ) ??
    null;
  const linkedMember =
    members.find((member) => member.email?.toLowerCase() === email) ?? null;
  const now = new Date().toISOString();

  if (existing) {
    await ctx.db.patch(existing._id, {
      email: args.email,
      displayName: args.displayName,
      authProvider: "better-auth",
      authSubject: args.authSubject,
      memberId: existing.memberId ?? linkedMember?._id,
      emailVerifiedAtISO: args.emailVerified ? now : existing.emailVerifiedAtISO,
      lastLoginAtISO: now,
      status: existing.status === "Invited" ? "Active" : existing.status,
    });
    return { userId: existing._id };
  }

  const ownerRole = users.length === 0 ? "Owner" : linkedMember ? "Member" : "Viewer";
  const userId = await ctx.db.insert("users", {
    societyId: args.societyId,
    email: args.email,
    displayName: args.displayName,
    role: ownerRole,
    authProvider: "better-auth",
    authSubject: args.authSubject,
    memberId: linkedMember?._id,
    status: "Active",
    createdAtISO: now,
    emailVerifiedAtISO: args.emailVerified ? now : undefined,
    lastLoginAtISO: now,
  });
  return { userId };
}

export async function recordLoginPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.patch(id, { lastLoginAtISO: new Date().toISOString() });
}
