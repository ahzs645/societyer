import { authorizedAction, authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { buildConvexCapabilities } from "./providers/capabilities";
import {
  normalizeNotificationLink,
  notificationsList,
  notificationsUnreadCount,
  notificationCreate,
  notificationMarkRead,
  notificationMarkAllRead,
  notificationDismiss,
  notificationSnooze,
  notificationDismissAll,
  notificationRemove,
  notificationRemoveAllDismissed,
  notificationsListPrefs,
  notificationUpsertPref,
  notificationSettings,
  notificationSetMyPref,
  notificationSetRule,
  notificationEvaluateAlerts,
  scanSocietyAlerts,
  buildDigestPlan,
  type DigestRecipient,
} from "../shared/functions/notifications";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export { normalizeNotificationLink };

export const list = authorizedQuery("notifications:list", query)({
  args: {
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
    // The bell omits this (dismissed rows stay hidden); the full Notifications
    // page passes true so cleared items remain visible until the purge.
    includeDismissed: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => notificationsList(await toPortableQueryCtx(ctx), args),
});

export const unreadCount = authorizedQuery("notifications:unreadCount", query)({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => notificationsUnreadCount(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("notifications:create", mutation)({
  args: {
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")),
    kind: v.string(),
    severity: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    linkHref: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => notificationCreate(await toPortableMutationCtx(ctx), args),
});

export const markRead = authorizedMutation("notifications:markRead", mutation)({
  args: { id: v.id("notifications") },
  returns: v.any(),
  handler: async (ctx, args) => notificationMarkRead(await toPortableMutationCtx(ctx), args),
});

export const markAllRead = authorizedMutation("notifications:markAllRead", mutation)({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => notificationMarkAllRead(await toPortableMutationCtx(ctx), args),
});

/** Clear a single notification from the bell. Stamps dismissedAt (and readAt
 * if not already read) so it leaves the bell + unread count immediately, but
 * the row survives on the Notifications page until `purgeDismissed` runs. */
export const dismiss = authorizedMutation("notifications:dismiss", mutation)({
  args: { id: v.id("notifications") },
  returns: v.any(),
  handler: async (ctx, args) => notificationDismiss(await toPortableMutationCtx(ctx), args),
});

/** Hide a notification from the bell until `untilISO` (null un-snoozes it). The
 *  row resurfaces automatically once the time passes — no purge needed. */
export const snooze = authorizedMutation("notifications:snooze", mutation)({
  args: { id: v.id("notifications"), untilISO: v.union(v.string(), v.null()) },
  returns: v.any(),
  handler: async (ctx, args) => notificationSnooze(await toPortableMutationCtx(ctx), args),
});

/** Clear every (non-dismissed) notification for this user/society from the bell. */
export const dismissAll = authorizedMutation("notifications:dismissAll", mutation)({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => notificationDismissAll(await toPortableMutationCtx(ctx), args),
});

/** Permanently delete a single notification now, without waiting for the
 * retention purge. Used by the "Delete permanently" action on the
 * Notifications page (Dismissed tab). */
export const remove = authorizedMutation("notifications:remove", mutation)({
  args: { id: v.id("notifications") },
  returns: v.any(),
  handler: async (ctx, args) => notificationRemove(await toPortableMutationCtx(ctx), args),
});

/** Permanently delete every dismissed notification for this user/society now. */
export const removeAllDismissed = authorizedMutation("notifications:removeAllDismissed", mutation)({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => notificationRemoveAllDismissed(await toPortableMutationCtx(ctx), args),
});

/** Default retention window (days) when a society hasn't set its own. Mirrored
 * by the default in the Settings UI. */
export const DEFAULT_DISMISSED_RETENTION_DAYS = 30;

/** Daily cleanup in bounded pages. Targeted/untouched legacy notifications can
 * be deleted; a person's expired broadcast dismissal becomes a compact
 * tombstone. Keep that tombstone while the broadcast exists so it cannot
 * reappear for that person or disappear for another person. */
export const purgeDismissed = internalMutation({
  args: { cursor: v.optional(v.string()), phase: v.optional(v.union(v.literal("notifications"), v.literal("receipts"))) },
  returns: v.object({ purged: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor, phase = "notifications" }) => {
    const now = Date.now();
    // Per-society cutoff ISO string, computed once. null = keep forever.
    const cutoffBySociety = new Map<string, string | null>();
    const cutoffFor = async (societyId: Id<"societies">): Promise<string | null> => {
      const key = societyId;
      if (cutoffBySociety.has(key)) return cutoffBySociety.get(key)!;
      const society = await ctx.db.get(societyId);
      const days = society?.notificationRetentionDays ?? DEFAULT_DISMISSED_RETENTION_DAYS;
      const cutoff = days <= 0 ? null : new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
      cutoffBySociety.set(key, cutoff);
      return cutoff;
    };

    if (phase === "receipts") {
      const rows = await ctx.db.query("notificationReceipts")
        .withIndex("by_dismissed_at", q => q.gt("dismissedAt", ""))
        .paginate({ cursor: cursor ?? null, numItems: 200 });
      let purged = 0;
      for (const receipt of rows.page) {
        const cutoff = await cutoffFor(receipt.societyId);
        if (!cutoff || !receipt.dismissedAt || receipt.dismissedAt >= cutoff) continue;
        if (!await ctx.db.get(receipt.notificationId)) await ctx.db.delete(receipt._id);
        else await ctx.db.patch(receipt._id, { removedAt: receipt.removedAt ?? new Date(now).toISOString(), dismissedAt: undefined, snoozedUntilISO: undefined });
        purged += 1;
      }
      if (!rows.isDone) await ctx.scheduler.runAfter(0, internal.notifications.purgeDismissed, { phase, cursor: rows.continueCursor });
      return { purged, isDone: rows.isDone };
    }

    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_dismissed_at", (q) => q.gt("dismissedAt", ""))
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    let purged = 0;
    for (const r of rows.page) {
      if (!r.dismissedAt) continue;
      const cutoff = await cutoffFor(r.societyId);
      if (cutoff && r.dismissedAt < cutoff) {
        // A historical broadcast may have acquired personal receipts since
        // rollout. Its global flag is no longer permission to erase it for all.
        if (!r.userId && await ctx.db.query("notificationReceipts").withIndex("by_notification", q => q.eq("notificationId", r._id)).first()) continue;
        await ctx.db.delete(r._id);
        purged++;
      }
    }
    if (!rows.isDone) {
      await ctx.scheduler.runAfter(0, internal.notifications.purgeDismissed, {
        phase,
        cursor: rows.continueCursor,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.notifications.purgeDismissed, { phase: "receipts" });
    }
    return { purged, isDone: false };
  },
});

export const listPrefs = authorizedQuery("notifications:listPrefs", query)({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, args) => notificationsListPrefs(await toPortableQueryCtx(ctx), args),
});

export const upsertPref = authorizedMutation("notifications:upsertPref", mutation)({
  args: {
    userId: v.id("users"),
    channel: v.string(),
    kind: v.string(),
    enabled: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => notificationUpsertPref(await toPortableMutationCtx(ctx), args),
});


/** The signed-in person's notification settings: kinds, switches, thresholds, weekly preview. */
export const settings = authorizedQuery("notifications:settings", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => notificationSettings(await toPortableQueryCtx(ctx), args),
});

/** Turn one channel × kind switch on or off for the signed-in person. */
export const setMyPref = authorizedMutation("notifications:setMyPref", mutation)({
  args: {
    societyId: v.id("societies"),
    channel: v.string(),
    kind: v.string(),
    enabled: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => notificationSetMyPref(await toPortableMutationCtx(ctx), args),
});

/** Change a workspace alert threshold (budget %, low balance, deadline lead, claim wait). */
export const setRule = authorizedMutation("notifications:setRule", mutation)({
  args: {
    societyId: v.id("societies"),
    rule: v.string(),
    enabled: v.boolean(),
    value: v.number(),
    accountId: v.optional(v.union(v.id("financialAccounts"), v.null())),
  },
  returns: v.any(),
  handler: async (ctx, args) => notificationSetRule(await toPortableMutationCtx(ctx), args),
});

/** Run the alert scan for one workspace now (the cron runs it twice a day). */
export const evaluateAlerts = authorizedMutation("notifications:evaluateAlerts", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => notificationEvaluateAlerts(await toPortableMutationCtx(ctx), args),
});

// Cron: scan deadlines, filings, grant reports, screenings, commitments and
// director terms (within each workspace's deadline lead time), plus the
// workspace thresholds: budget lines, low balance and claims waiting for
// approval. The scan is shared with the in-browser workspace.
export const scanUpcoming = internalMutation({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const societies = societyId
      ? [await ctx.db.get(societyId)]
      : await ctx.db.query("societies").collect();
    const portable = await toPortableMutationCtx(ctx);
    let created = 0;
    for (const s of societies) {
      if (!s) continue;
      created += (await scanSocietyAlerts(portable, s._id)).created;
    }
    return { societies: societies.length, created };
  },
});

/** Digest recipients and their lines, honouring each person's switches and permissions. */
export const digestPlan = internalQuery({
  args: { societyId: v.id("societies"), cadence: v.union(v.literal("daily"), v.literal("weekly")) },
  returns: v.any(),
  handler: async (ctx, { societyId, cadence }) => {
    const society = await ctx.db.get(societyId);
    if (!society) return { demo: false, recipients: [] };
    const recipients = await buildDigestPlan(await toPortableQueryCtx(ctx), societyId, cadence);
    return { demo: (society as any).demoMode === true, recipients };
  },
});

type DigestCadence = "daily" | "weekly";

async function deliverDigest(ctx: any, societyId: Id<"societies">, cadence: DigestCadence) {
  const { demo, recipients } = await ctx.runQuery(internal.notifications.digestPlan, { societyId, cadence });
  // Reach delivery providers through the injected capability bag instead of
  // importing them directly. A runtime without email/sms wired gets a
  // structured CAPABILITY_UNAVAILABLE rather than a silent send.
  const capabilities = buildConvexCapabilities(undefined, { demo });
  let emailsSent = 0;
  let smsSent = 0;
  for (const r of recipients as DigestRecipient[]) {
    if (r.email) {
      const subject = cadence === "weekly"
        ? "Societyer weekly summary"
        : `Societyer digest — ${r.emailCount} open item${r.emailCount === 1 ? "" : "s"}`;
      const intro = cadence === "weekly" ? "Here's your week ahead:" : "Your open items:";
      await capabilities.email.sendEmail({
        to: r.email,
        subject,
        text: `Hi ${r.displayName},\n\n${intro}\n${r.emailLines.join("\n")}\n\nOpen Societyer to review. Change what you receive under Notifications → Settings.`,
        tag: cadence === "weekly" ? "digest-weekly" : "digest",
      });
      emailsSent += 1;
    }
    // Text messages are opt-in: the plan only carries a phone for people who turned them on.
    if (r.phone && r.smsSummary) {
      await capabilities.sms.sendSms({ to: r.phone, body: `Societyer: ${r.smsSummary}`, tag: "digest" });
      smsSent += 1;
    }
  }
  return { emailsSent, smsSent };
}

// Action: send the digest now for one workspace (the "Send digest" button).
export const sendDigest = authorizedAction("notifications:sendDigest", action)({
  args: { societyId: v.id("societies"), cadence: v.optional(v.union(v.literal("daily"), v.literal("weekly"))) },
  returns: v.any(),
  handler: async (ctx, { societyId, cadence }) => deliverDigest(ctx, societyId, cadence ?? "daily"),
});

async function deliverToEverySociety(ctx: any, cadence: DigestCadence) {
  const societies = await ctx.runQuery(internal.notifications.societyIds, {});
  let emailsSent = 0;
  let smsSent = 0;
  for (const societyId of societies as Id<"societies">[]) {
    const r = await deliverDigest(ctx, societyId, cadence);
    emailsSent += r.emailsSent;
    smsSent += r.smsSent;
  }
  return { societies: societies.length, emailsSent, smsSent };
}

export const societyIds = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => (await ctx.db.query("societies").collect()).map((s) => s._id),
});

// Cron entry: the daily digest for every workspace.
export const sendDailyDigests = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx) => deliverToEverySociety(ctx, "daily"),
});

// Cron entry: the weekly summary (opt-in) for every workspace.
export const sendWeeklyDigests = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx) => deliverToEverySociety(ctx, "weekly"),
});
