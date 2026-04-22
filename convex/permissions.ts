import { query } from "./_generated/server";
import { v } from "convex/values";
import { hasPermission, listPermissionsForRole, PERMISSIONS, type Permission } from "./lib/permissions";

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
  handler: async (ctx, { userId, societyId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.societyId !== societyId) return { role: null, permissions: [] };
    return {
      role: user.role,
      permissions: listPermissionsForRole(user.role) as readonly string[],
    };
  },
});

export const listAll = query({
  args: {},
  returns: v.any(),
  handler: async () => PERMISSIONS.map((p) => p),
});
