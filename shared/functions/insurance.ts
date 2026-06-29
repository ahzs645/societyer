/**
 * PORTABLE FUNCTIONS: the insurance domain (list / create / update / remove).
 *
 * Straight CRUD over the `insurancePolicies` table on `ctx.db`. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("insurancePolicies")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function createPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  const now = new Date().toISOString();
  return await ctx.db.insert("insurancePolicies", {
    ...args,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: { id: string; patch: Record<string, any> },
) {
  await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
