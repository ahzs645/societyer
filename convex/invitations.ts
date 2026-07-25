import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { listPortable, createPortable, revokePortable, getByTokenPortable } from "../shared/functions/invitations";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    email: v.string(),
    role: v.string(),
    invitedByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const revoke = mutation({
  args: { id: v.id("invitations") },
  returns: v.any(),
  handler: async (ctx, args) => revokePortable(await toPortableMutationCtx(ctx), args),
});

export const getByToken = query({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => getByTokenPortable(await toPortableQueryCtx(ctx), args),
});
