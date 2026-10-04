import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import { hasPermission, requirePermissionPortable, type Permission } from "../../shared/functions/permissions";
import { toPortableQueryCtx } from "./portable";
import { requireSocietyMembership } from "../../shared/functions/access";
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
  const user = await requireSocietyMembership(await toPortableQueryCtx(ctx), societyId);
  if (user._id !== userId) throw new ConvexError({ code: "FORBIDDEN", message: "Actor does not match the current principal." });
  return user.role as Role;
}

export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  societyId: Id<"societies">,
  userId: Id<"users">,
  permission: Permission,
): Promise<Doc<"users">> {
  const user = await requirePermissionPortable(await toPortableQueryCtx(ctx), societyId, permission);
  if (user._id !== userId) throw new ConvexError({ code: "FORBIDDEN", message: "Actor does not match the current principal." });
  return user as Doc<"users">;
}
