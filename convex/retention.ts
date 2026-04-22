// @ts-nocheck
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Weekly sweep — find documents whose `retentionYears` has elapsed since
 * `createdAtISO` and flag them for deletion review. Also drops an in-app
 * notification on each society that has at least one newly-flagged record.
 */
export const flagExpired = internalMutation({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const all = await ctx.db.query("documents").collect();
    const now = Date.now();
    const perSociety = new Map<string, number>();
    for (const d of all) {
      if (d.archivedAtISO) continue;
      if (d.flaggedForDeletion) continue;
      if (!d.retentionYears || d.retentionYears >= 99) continue;
      const createdMs = new Date(d.createdAtISO).getTime();
      const expiresMs = createdMs + d.retentionYears * 365.25 * 86_400_000;
      if (expiresMs < now) {
        await ctx.db.patch(d._id, { flaggedForDeletion: true });
        perSociety.set(
          d.societyId as unknown as string,
          (perSociety.get(d.societyId as unknown as string) ?? 0) + 1,
        );
      }
    }
    for (const [societyId, count] of perSociety) {
      await ctx.db.insert("notifications", {
        societyId: societyId as any,
        kind: "general",
        severity: "info",
        title: "Records due for retention review",
        body: `${count} document(s) have passed their retention period and are flagged for review.`,
        linkHref: "/retention",
        createdAtISO: new Date().toISOString(),
      });
    }
    return { flagged: Array.from(perSociety.values()).reduce((a, b) => a + b, 0) };
  },
});

/**
 * Jan 2 each year — drops a notification on every society reminding directors
 * to renew their annual eligibility attestation for the new year.
 */
export const openAttestationYear = internalMutation({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const societies = await ctx.db.query("societies").collect();
    const year = new Date().getFullYear();
    for (const s of societies) {
      await ctx.db.insert("notifications", {
        societyId: s._id,
        kind: "general",
        severity: "warn",
        title: `Director attestations for ${year} are open`,
        body: "Each active director should sign the annual eligibility attestation.",
        linkHref: "/attestations",
        createdAtISO: new Date().toISOString(),
      });
    }
  },
});

/** Browse-time query: documents past retention (for the UI page). */
export const expiredForSociety = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
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
  },
});
