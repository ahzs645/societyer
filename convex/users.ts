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
  // Demo-friendly: if no acting user is supplied, fall back to Owner. This
  // keeps the seeded app usable without an auth provider wired in.
  if (!args.actingUserId) return { user: null };
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
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("users")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("users") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return rows[0] ?? null;
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
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { lastLoginAtISO: new Date().toISOString() });
  },
});
