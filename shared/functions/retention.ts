/**
 * PORTABLE FUNCTIONS: the retention domain (expiredForSociety).
 *
 * Read over the `documents` table via `ctx.db`, then a pure JS map/filter/sort
 * to compute which documents are past their retention period. Runs unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * The two scheduled sweeps (`flagExpired` / `openAttestationYear`) stay in
 * convex/retention.ts: they are `internalMutation`s driven by Convex cron, not
 * part of the portable query/mutation surface.
 */

import type { PortableQueryCtx } from "../portable/ctx";

/** Browse-time query: documents past retention (for the UI page). */
export async function expiredForSocietyPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const docs = await ctx.db
    .query("documents")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const now = Date.now();
  return docs
    .map((d) => {
      const createdMs = new Date(d.createdAtISO).getTime();
      const years = d.retentionYears ?? 0;
      const expiresMs = years > 0 ? createdMs + years * 365.25 * 86_400_000 : null;
      const daysOverdue = expiresMs
        ? Math.floor((now - expiresMs) / 86_400_000)
        : null;
      return { doc: d, expiresMs, daysOverdue };
    })
    .filter(
      (r) =>
        !r.doc.archivedAtISO &&
        r.daysOverdue != null &&
        (r.daysOverdue >= 0 || r.doc.flaggedForDeletion),
    )
    .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
}
