import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { hasPermission, PERMISSIONS, type Permission } from "./lib/permissions";
import { myPermissionsPortable } from "../shared/functions/permissions";
import { toPortableQueryCtx } from "./lib/portable";

export const check = query({
  args: {
    userId: v.id("users"),
    societyId: v.id("societies"),
    permission: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { userId, societyId, permission }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.societyId !== societyId) return false;
    return hasPermission(user.role, permission as Permission);
  },
});

export const myPermissions = query({
  args: {
    userId: v.id("users"),
    societyId: v.id("societies"),
  },
  returns: v.any(),
  handler: (ctx, args) => myPermissionsPortable(toPortableQueryCtx(ctx), args),
});

export const listAll = query({
  args: {},
  returns: v.any(),
  handler: async () => PERMISSIONS.map((p) => p),
});
