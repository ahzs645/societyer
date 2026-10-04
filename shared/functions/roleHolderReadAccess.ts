import type { PortableQueryCtx } from "../portable/ctx";
import { requirePermissionPortable, type Permission } from "./permissions";

/** Structured registers keep the authority of their dedicated resource views. */
async function canReadRegister(ctx: PortableQueryCtx, societyId: string, permission: Permission): Promise<boolean> {
  try {
    await requirePermissionPortable(ctx, societyId, permission);
    return true;
  } catch (error) {
    if (error instanceof Error && [`Permission ${permission} required.`, `Service scope ${permission} required.`].includes(error.message)) return false;
    throw error;
  }
}

/** Compatibility helpers for callers checking only the controller register. */
export async function canReadControllerRegisters(ctx: PortableQueryCtx, societyId: string): Promise<boolean> {
  return canReadRegister(ctx, societyId, "settings:read");
}

export async function filterControllerRegisters<T extends Record<string, unknown>>(ctx: PortableQueryCtx, societyId: string, rows: T[]): Promise<T[]> {
  return await canReadControllerRegisters(ctx, societyId) ? rows : rows.filter(row => row.roleType !== "controller");
}

export async function readableRoleHolderTypes(ctx: PortableQueryCtx, societyId: string) {
  const [directors, controllers] = await Promise.all([
    canReadRegister(ctx, societyId, "directors:read"),
    canReadRegister(ctx, societyId, "settings:read"),
  ]);
  return (roleType: unknown) => roleType === "controller" ? controllers : ["director", "officer"].includes(String(roleType)) ? directors : true;
}

export async function filterRoleHolderRegisters<T extends Record<string, unknown>>(ctx: PortableQueryCtx, societyId: string, rows: T[]): Promise<T[]> {
  const readable = await readableRoleHolderTypes(ctx, societyId);
  return rows.filter(row => readable(row.roleType));
}

/** Batch the scoped revisions once; current readable rows can have protected past types. */
export async function roleHolderHistoryAccess(ctx: PortableQueryCtx, societyId: string) {
  const [canReadHistory, readable, revisions] = await Promise.all([
    canReadRegister(ctx, societyId, "members:read"),
    readableRoleHolderTypes(ctx, societyId),
    ctx.db.query("roleHolderRevisions").withIndex("by_society", q => q.eq("societyId", societyId)).collect(),
  ]);
  const restrictedIds = new Set<string>();
  for (const revision of revisions) {
    try {
      if (!readable(JSON.parse(String(revision.dataJson ?? "{}")).roleType)) restrictedIds.add(String(revision.roleHolderId));
    } catch {
      restrictedIds.add(String(revision.roleHolderId));
    }
  }
  return (row: Record<string, unknown>) => canReadHistory && readable(row.roleType) && !restrictedIds.has(String(row._id));
}
