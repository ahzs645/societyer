/**
 * PORTABLE FUNCTIONS: the filing-bot run read surface.
 *
 * `listRuns`, `runsForFiling`, and `getRun` read exclusively through the
 * portable `ctx.db` contract, so they run unchanged on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 *
 * The run preparation surface (`run`, `buildFilingPacket`, the internal
 * `_createRun` / `_updateStep` / `_completeRun` / `_patchFiling` mutations) stays
 * on Convex: it depends on `ctx.scheduler`/`ctx.runQuery`/`ctx.runMutation`, the
 * notification fan-out, and the step catalog.
 */

import type { PortableQueryCtx } from "../portable/ctx";

export async function listRunsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  return ctx.db
    .query("filingBotRuns")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 20);
}

export async function runsForFilingPortable(ctx: PortableQueryCtx, { filingId }: { filingId: string }) {
  return ctx.db
    .query("filingBotRuns")
    .withIndex("by_filing", (q) => q.eq("filingId", filingId))
    .order("desc")
    .collect();
}

export async function getRunPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}
