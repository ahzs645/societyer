import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  usersList,
  userGet,
  userGetByEmail,
  userGetByAuthSubject,
  resolveAuthSessionPortable,
  recordLoginPortable,
} from "../shared/functions/users";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

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

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => usersList(toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("users") },
  returns: v.any(),
  handler: (ctx, args) => userGet(toPortableQueryCtx(ctx), args),
});

export const getByEmail = query({
  args: { email: v.string() },
  returns: v.any(),
  handler: (ctx, args) => userGetByEmail(toPortableQueryCtx(ctx), args),
});

export const getByAuthSubject = query({
  args: { authSubject: v.string() },
  returns: v.any(),
  handler: (ctx, args) => userGetByAuthSubject(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => resolveAuthSessionPortable(toPortableMutationCtx(ctx), args),
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
    // First user in a society is always Owner — the role field on the create
    // form is ignored for this single bootstrap insert. Subsequent users honour
    // the form value.
    const peers = await ctx.db
      .query("users")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .first();
    const role = peers ? rest.role : "Owner";
    return await ctx.db.insert("users", {
      ...rest,
      role,
      createdAtISO: new Date().toISOString(),
    });
  },
});

// Throws if removing/demoting `target` would leave its society with zero
// Owners. Call before any patch/delete that strips Owner status from `target`.
async function assertNotLastOwner(
  ctx: MutationCtx,
  target: { _id: Id<"users">; societyId: Id<"societies">; role: string },
) {
  if (target.role !== "Owner") return;
  const otherOwners = await ctx.db
    .query("users")
    .withIndex("by_society", (q) => q.eq("societyId", target.societyId))
    .filter((q) => q.neq(q.field("_id"), target._id))
    .filter((q) => q.eq(q.field("role"), "Owner"))
    .first();
  if (!otherOwners) {
    throw new Error("Can't remove the last Owner — promote another user to Owner first.");
  }
}

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
    if (role !== "Owner") await assertNotLastOwner(ctx, target);
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
    await assertNotLastOwner(ctx, target);
    await ctx.db.delete(id);
  },
});

export const recordLogin = mutation({
  args: { id: v.id("users") },
  returns: v.any(),
  handler: (ctx, args) => recordLoginPortable(toPortableMutationCtx(ctx), args),
});
