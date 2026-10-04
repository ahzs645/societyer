import type { PortableQueryCtx } from "../portable/ctx";
import { requirePermissionPortable } from "./permissions";

/** Full controller records include non-public dates of birth and addresses.
 * The live register uses the same current permission as its dedicated ISC view. */
export async function canReadControllerRegisters(ctx: PortableQueryCtx, societyId: string): Promise<boolean> {
  try {
    await requirePermissionPortable(ctx, societyId, "settings:read");
    return true;
  } catch (error) {
    if (error instanceof Error && ["Permission settings:read required.", "Service scope settings:read required."].includes(error.message)) return false;
    throw error;
  }
}

export async function filterControllerRegisters<T extends Record<string, unknown>>(ctx: PortableQueryCtx, societyId: string, rows: T[]): Promise<T[]> {
  return await canReadControllerRegisters(ctx, societyId) ? rows : rows.filter(row => row.roleType !== "controller");
}
