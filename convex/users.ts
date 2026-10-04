import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  usersList,
  userGet,
  userGetByEmail,
  userGetByAuthSubject,
  ensureCurrentMembershipPortable,
  recordLoginPortable,
  setRolePortable,
  upsertUserPortable,
  removeUserPortable,
  securityDisableUserPortable,
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

export const list = authorizedQuery("users:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => usersList(await toPortableQueryCtx(ctx), args),
});

export const get = authorizedQuery("users:get", query)({
  args: { id: v.id("users") },
  returns: v.any(),
  handler: async (ctx, args) => userGet(await toPortableQueryCtx(ctx), args),
});

export const getByEmail = authorizedQuery("users:getByEmail", query)({
  args: { email: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => userGetByEmail(await toPortableQueryCtx(ctx), args),
});

export const getByAuthSubject = authorizedQuery("users:getByAuthSubject", query)({
  args: { authSubject: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => userGetByAuthSubject(await toPortableQueryCtx(ctx), args),
});

export const ensureCurrentMembership = authorizedMutation("users:ensureCurrentMembership", mutation)({
  args: {
    societyId: v.id("societies"),
    invitationToken: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => ensureCurrentMembershipPortable(await toPortableMutationCtx(ctx), args),
});

export const upsert = authorizedMutation("users:upsert", mutation)({
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
  handler: async (ctx, args) => upsertUserPortable(await toPortableMutationCtx(ctx), args),
});

export const setRole = authorizedMutation("users:setRole", mutation)({
  args: {
    id: v.id("users"),
    role: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => setRolePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("users:remove", mutation)({
  args: { id: v.id("users"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => removeUserPortable(await toPortableMutationCtx(ctx), args),
});

export const securityDisable = authorizedMutation("users:securityDisable", mutation)({
  args: { id: v.id("users"), reason: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => securityDisableUserPortable(await toPortableMutationCtx(ctx), args),
});

export const recordLogin = authorizedMutation("users:recordLogin", mutation)({
  args: { id: v.id("users") },
  returns: v.any(),
  handler: async (ctx, args) => recordLoginPortable(await toPortableMutationCtx(ctx), args),
});
