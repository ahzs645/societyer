/**
 * PORTABLE FUNCTIONS: the records-location domain (get / upsert).
 *
 * Reads/writes the `recordsLocation` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function recordsLocationGet(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("recordsLocation")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows[0] ?? null;
}

export async function recordsLocationUpsert(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    address: string;
    noticePostedAtOffice: boolean;
    postedAtISO?: string;
    computerProvidedForInspection: boolean;
    notes?: string;
  },
): Promise<string> {
  const existing = await ctx.db
    .query("recordsLocation")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  if (existing[0]) {
    const { societyId, ...patch } = args;
    await ctx.db.patch(existing[0]._id, patch);
    return existing[0]._id;
  }
  return ctx.db.insert("recordsLocation", args);
}
