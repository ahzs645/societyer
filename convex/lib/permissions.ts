import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import { hasPermission, type Permission } from "../../shared/functions/permissions";
import type { Role } from "../../shared/functions/access";

export {
  PERMISSIONS,
  ROLE_MATRIX,
  listPermissionsForRole,
} from "../../shared/functions/permissions";
export { hasPermission };
export type { Permission } from "../../shared/functions/permissions";

export async function resolveUserRole(
  ctx: QueryCtx | MutationCtx,
  societyId: Id<"societies">,
  userId: Id<"users">,
): Promise<Role> {
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
  if (user.societyId !== societyId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "User does not belong to this society." });
  }
  return user.role as Role;
}

export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  societyId: Id<"societies">,
  userId: Id<"users">,
  permission: Permission,
): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
  if (user.societyId !== societyId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "User does not belong to this society." });
  }
  if (!hasPermission(user.role, permission)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `Your role (${user.role}) does not have "${permission}" permission.`,
    });
  }
  return user;
}
