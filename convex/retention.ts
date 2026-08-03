// @ts-nocheck
import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { expiredForSocietyPortable } from "../shared/functions/retention";
import { toPortableQueryCtx } from "./lib/portable";

/**
 * Weekly sweep — find documents whose `retentionYears` has elapsed since
 * `createdAtISO` and flag them for deletion review. Also drops an in-app
 * notification on each society that has at least one newly-flagged record.
 */
export const flagExpired = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { cursor }) => {
    const batch = await ctx.db.query("documents").paginate({
      cursor: cursor ?? null,
      numItems: 200,
    });
    const now = Date.now();
    const perSociety = new Map<string, number>();
    for (const d of batch.page) {
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
    if (!batch.isDone) {
      await ctx.scheduler.runAfter(0, internal.retention.flagExpired, {
        cursor: batch.continueCursor,
      });
    }
    return {
      flagged: Array.from(perSociety.values()).reduce((a, b) => a + b, 0),
      isDone: batch.isDone,
    };
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
  handler: async (ctx, args) => expiredForSocietyPortable(await toPortableQueryCtx(ctx), args),
});
