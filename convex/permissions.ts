import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { PERMISSIONS } from "./lib/permissions";
import { checkPermissionPortable, myPermissionsPortable } from "../shared/functions/permissions";
import { toPortableQueryCtx } from "./lib/portable";

export const check = query({
  args: {
    userId: v.id("users"),
    societyId: v.id("societies"),
    permission: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => checkPermissionPortable(await toPortableQueryCtx(ctx), args),
});

export const myPermissions = query({
  args: {
    userId: v.id("users"),
    societyId: v.id("societies"),
  },
  returns: v.any(),
  handler: async (ctx, args) => myPermissionsPortable(await toPortableQueryCtx(ctx), args),
});

export const listAll = query({
  args: {},
  returns: v.any(),
  handler: async () => PERMISSIONS.map((p) => p),
});
