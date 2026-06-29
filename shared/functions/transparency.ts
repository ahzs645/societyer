/**
 * PORTABLE FUNCTIONS: the transparency domain
 * (listPublications).
 *
 * Reads the `publications` table over `ctx.db`. The handler runs unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * Server-only handlers stay on Convex (convex/transparency.ts):
 *   - upsertPublication (mutation; requireRole)
 *   - removePublication (mutation; requireRole)
 *   - publicCenter (query; createDownloadUrl provider + ctx.storage.getUrl)
 */

import type { PortableQueryCtx } from "../portable/ctx";

export async function listPublicationsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
): Promise<any[]> {
  return ctx.db
    .query("publications")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}
