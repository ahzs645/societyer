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
import { getOwned, requireSocietyMembership } from "./access";

export async function listRunsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("filingBotRuns")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 20);
}

export async function runsForFilingPortable(ctx: PortableQueryCtx, { filingId }: { filingId: string }) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await requireSocietyMembership(ctx, societyId);
  await getOwned(ctx, "filings", filingId, societyId);
  return ctx.db
    .query("filingBotRuns")
    .withIndex("by_filing", (q) => q.eq("filingId", filingId))
    .order("desc")
    .collect();
}

export async function getRunPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await requireSocietyMembership(ctx, societyId);
  return getOwned(ctx, "filingBotRuns", id, societyId);
}
