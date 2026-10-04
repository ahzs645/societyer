import type { PortableQueryCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";

/** Mixed-resource reads keep only sections the current actor and service scope allow. */
export async function readableProjectionPermissions(ctx: PortableQueryCtx, societyId: string, permissions: readonly Permission[]) {
  await requireSocietyMembership(ctx, societyId);
  const readable = new Set<Permission>();
  await Promise.all([...new Set(permissions)].map(async permission => {
    try {
      await requirePermissionPortable(ctx, societyId, permission);
      readable.add(permission);
    } catch (error) {
      if (!(error instanceof Error) || !/^(Permission|Service scope) .+ required\.$/.test(error.message)) throw error;
    }
  }));
  return readable;
}
