/**
 * PORTABLE FUNCTIONS: the activity domain (list / listForRecord / log).
 *
 * Reads/writes the `activity` table over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  const rows = await ctx.db
    .query("activity")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 30);
  return rows;
}

export async function listForRecordPortable(
  ctx: PortableQueryCtx,
  {
    societyId,
    entityType,
    entityId,
    limit,
  }: { societyId: string; entityType: string; entityId: string; limit?: number },
) {
  return ctx.db
    .query("activity")
    .withIndex("by_entity", (q) =>
      q.eq("societyId", societyId).eq("entityType", entityType).eq("entityId", entityId),
    )
    .order("desc")
    .take(limit ?? 100);
}

export async function logPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    actor: string;
    entityType: string;
    entityId?: string;
    action: string;
    summary: string;
  },
) {
  return ctx.db.insert("activity", { ...args, createdAtISO: new Date().toISOString() });
}
