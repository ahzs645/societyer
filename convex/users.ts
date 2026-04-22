import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

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

export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  args: { actingUserId?: Id<"users"> | null; societyId: Id<"societies">; required: Role },
): Promise<{ user: any | null }> {
  if (!args.actingUserId) {
    throw new Error(`Role ${args.required} required — no authenticated actor.`);
  }
  const user = await ctx.db.get(args.actingUserId);
  if (!user) throw new Error("Unknown user.");
  if (user.societyId !== args.societyId) throw new Error("User is not part of this society.");
  if (!canActAs(user.role as Role, args.required)) {
    throw new Error(`Role ${args.required} required — you have ${user.role}.`);
  }
  return { user };
}

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("users")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getByEmail = query({
  args: { email: v.string() },
  returns: v.any(),
  handler: async (ctx, { email }) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return rows[0] ?? null;
  },
});

export const getByAuthSubject = query({
  args: { authSubject: v.string() },
  returns: v.any(),
  handler: async (ctx, { authSubject }) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
      .collect();
    return rows[0] ?? null;
  },
});

export const resolveAuthSession = mutation({
  args: {
    societyId: v.id("societies"),
    authSubject: v.string(),
    email: v.string(),
    displayName: v.string(),
    emailVerified: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
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
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("users")),
    societyId: v.id("societies"),
    email: v.string(),
    displayName: v.string(),
    role: v.string(),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    status: v.string(),
    avatarColor: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });
    const { id, actingUserId, ...rest } = args;
    if (id) {
      await ctx.db.patch(id, rest);
      return id;
    }
    return await ctx.db.insert("users", {
      ...rest,
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const setRole = mutation({
  args: {
    id: v.id("users"),
    role: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, role, actingUserId }) => {
    const target = await ctx.db.get(id);
    if (!target) throw new Error("User not found.");
    await requireRole(ctx, {
      actingUserId,
      societyId: target.societyId,
      required: "Admin",
    });
    await ctx.db.patch(id, { role });
  },
});

export const remove = mutation({
  args: { id: v.id("users"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const target = await ctx.db.get(id);
    if (!target) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: target.societyId,
      required: "Owner",
    });
    await ctx.db.delete(id);
  },
});

export const recordLogin = mutation({
  args: { id: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { lastLoginAtISO: new Date().toISOString() });
  },
});
