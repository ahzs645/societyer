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
  setRolePortable,
} from "../shared/functions/users";
import { ROLES, canActAs, requireRolePortable, type Role } from "../shared/functions/access";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export { ROLES, canActAs };
export type { Role };

export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  args: { actingUserId?: Id<"users"> | null; societyId: Id<"societies">; required: Role },
): Promise<{ user: any | null }> {
  return requireRolePortable(await toPortableQueryCtx(ctx), {
    actingUserId: args.actingUserId ?? undefined,
    societyId: args.societyId,
    required: args.required,
  });
}

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => usersList(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("users") },
  returns: v.any(),
  handler: async (ctx, args) => userGet(await toPortableQueryCtx(ctx), args),
});

export const getByEmail = query({
  args: { email: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => userGetByEmail(await toPortableQueryCtx(ctx), args),
});

export const getByAuthSubject = query({
  args: { authSubject: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => userGetByAuthSubject(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => resolveAuthSessionPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => setRolePortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => recordLoginPortable(await toPortableMutationCtx(ctx), args),
});
