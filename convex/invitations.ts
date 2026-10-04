import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  acceptPortable,
  createPortable,
  getByTokenPortable,
  listPortable,
  revokePortable,
} from "../shared/functions/invitations";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("invitations:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("invitations:create", mutation)({
  args: {
    societyId: v.id("societies"),
    email: v.string(),
    role: v.string(),
    expiresInDays: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const revoke = authorizedMutation("invitations:revoke", mutation)({
  args: { id: v.id("invitations") },
  returns: v.any(),
  handler: async (ctx, args) => revokePortable(await toPortableMutationCtx(ctx), args),
});

export const getByToken = authorizedQuery("invitations:getByToken", query)({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => getByTokenPortable(await toPortableQueryCtx(ctx), args),
});

export const accept = authorizedMutation("invitations:accept", mutation)({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => acceptPortable(await toPortableMutationCtx(ctx), args),
});
