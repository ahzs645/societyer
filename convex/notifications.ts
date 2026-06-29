import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { buildConvexCapabilities } from "./providers/capabilities";

/**
 * Notifications historically stored app-relative links as bare paths
 * (e.g. "/filings"), but every real route lives under "/app". Normalize on
 * READ so every click target resolves, without rewriting stored rows — which
 * keeps the scan dedup keys and `financialHub`'s demo-notification matcher
 * (both compare the raw stored value) working untouched.
 */
export function normalizeNotificationLink(href?: string): string | undefined {
  if (!href) return href;
  if (href.startsWith("/app") || href.startsWith("/demo") || href.startsWith("http")) {
    return href;
  }
  return href.startsWith("/") ? `/app${href}` : `/app/${href}`;
}

export const list = query({
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
  handler: async (ctx, { societyId, userId, limit, unreadOnly, includeDismissed }) => {
    const nowISO = new Date().toISOString();
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 100);
    return rows
      .filter((r) => {
        if (userId && r.userId && r.userId !== userId) return false;
        if (unreadOnly && r.readAt) return false;
        if (!includeDismissed && r.dismissedAt) return false;
        // Snoozed rows leave the bell until their time passes; the full page
        // (includeDismissed) still shows them so the user can un-snooze.
        if (!includeDismissed && r.snoozedUntilISO && r.snoozedUntilISO > nowISO) return false;
        return true;
      })
      .map((r) => ({ ...r, linkHref: normalizeNotificationLink(r.linkHref) }));
  },
});

export const unreadCount = query({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { societyId, userId }) => {
    const nowISO = new Date().toISOString();
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(200);
    return rows.filter((r) => {
      if (r.readAt) return false;
      if (r.dismissedAt) return false;
      if (r.snoozedUntilISO && r.snoozedUntilISO > nowISO) return false;
      if (userId && r.userId && r.userId !== userId) return false;
      return true;
    }).length;
  },
});

export const create = mutation({
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
  handler: async (ctx, args): Promise<Id<"notifications">> => {
    return await ctx.db.insert("notifications", {
      ...args,
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const markRead = mutation({
  args: { id: v.id("notifications") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { readAt: new Date().toISOString() });
  },
});

export const markAllRead = mutation({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { societyId, userId }) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const now = new Date().toISOString();
    for (const r of rows) {
      if (r.readAt) continue;
      if (userId && r.userId && r.userId !== userId) continue;
      await ctx.db.patch(r._id, { readAt: now });
    }
  },
});

/** Clear a single notification from the bell. Stamps dismissedAt (and readAt
 * if not already read) so it leaves the bell + unread count immediately, but
 * the row survives on the Notifications page until `purgeDismissed` runs. */
export const dismiss = mutation({
  args: { id: v.id("notifications") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const now = new Date().toISOString();
    const existing = await ctx.db.get(id);
    await ctx.db.patch(id, {
      dismissedAt: now,
      readAt: existing?.readAt ?? now,
    });
  },
});

/** Hide a notification from the bell until `untilISO` (null un-snoozes it). The
 *  row resurfaces automatically once the time passes — no purge needed. */
export const snooze = mutation({
  args: { id: v.id("notifications"), untilISO: v.union(v.string(), v.null()) },
  returns: v.any(),
  handler: async (ctx, { id, untilISO }) => {
    await ctx.db.patch(id, { snoozedUntilISO: untilISO ?? undefined });
  },
});

/** Clear every (non-dismissed) notification for this user/society from the bell. */
export const dismissAll = mutation({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { societyId, userId }) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const now = new Date().toISOString();
    for (const r of rows) {
      if (r.dismissedAt) continue;
      if (userId && r.userId && r.userId !== userId) continue;
      await ctx.db.patch(r._id, { dismissedAt: now, readAt: r.readAt ?? now });
    }
  },
});

/** Permanently delete a single notification now, without waiting for the
 * retention purge. Used by the "Delete permanently" action on the
 * Notifications page (Dismissed tab). */
export const remove = mutation({
  args: { id: v.id("notifications") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/** Permanently delete every dismissed notification for this user/society now. */
export const removeAllDismissed = mutation({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { societyId, userId }) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    let removed = 0;
    for (const r of rows) {
      if (!r.dismissedAt) continue;
      if (userId && r.userId && r.userId !== userId) continue;
      await ctx.db.delete(r._id);
      removed++;
    }
    return { removed };
  },
});

/** Default retention window (days) when a society hasn't set its own. Mirrored
 * by the default in the Settings UI. */
export const DEFAULT_DISMISSED_RETENTION_DAYS = 30;

/** Daily cleanup — hard-delete notifications dismissed longer ago than each
 * society's configured retention window. A retention of 0 means "keep forever",
 * so those societies are skipped. Driven by the cron in `crons.ts`. */
export const purgeDismissed = internalMutation({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
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

    const rows = await ctx.db.query("notifications").collect();
    let purged = 0;
    for (const r of rows) {
      if (!r.dismissedAt) continue;
      const cutoff = await cutoffFor(r.societyId);
      if (cutoff && r.dismissedAt < cutoff) {
        await ctx.db.delete(r._id);
        purged++;
      }
    }
    return { purged };
  },
});

export const listPrefs = query({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { userId }) =>
    ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
});

export const upsertPref = mutation({
  args: {
    userId: v.id("users"),
    channel: v.string(),
    kind: v.string(),
    enabled: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const match = existing.find(
      (p) => p.channel === args.channel && p.kind === args.kind,
    );
    if (match) {
      await ctx.db.patch(match._id, { enabled: args.enabled });
      return match._id;
    }
    return await ctx.db.insert("notificationPrefs", args);
  },
});

// Cron: scan upcoming deadlines and filings, raise notifications for anything
// due in ≤ 14 days that we haven't already notified about.
export const scanUpcoming = internalMutation({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const societies = societyId
      ? [await ctx.db.get(societyId)]
      : await ctx.db.query("societies").collect();

    const now = Date.now();
    const cutoff = now + 14 * 24 * 60 * 60 * 1000;
    // Board mandates get a longer runway than ordinary deadlines — re-election
    // has to be planned into the AGM agenda.
    const TERM_EXPIRY_LEAD_DAYS = 60;

    for (const s of societies) {
      if (!s) continue;

      const [deadlines, filings, grantReports, screenings, commitments, activeDirectors, recent] = await Promise.all([
        ctx.db
          .query("deadlines")
          .withIndex("by_society", (q) => q.eq("societyId", s._id))
          .collect(),
        ctx.db
          .query("filings")
          .withIndex("by_society", (q) => q.eq("societyId", s._id))
          .collect(),
        ctx.db
          .query("grantReports")
          .withIndex("by_society", (q) => q.eq("societyId", s._id))
          .collect(),
        ctx.db
          .query("volunteerScreenings")
          .withIndex("by_society", (q) => q.eq("societyId", s._id))
          .collect(),
        ctx.db
          .query("commitments")
          .withIndex("by_society", (q) => q.eq("societyId", s._id))
          .collect(),
        ctx.db
          .query("directors")
          .withIndex("by_society_status", (q) => q.eq("societyId", s._id).eq("status", "Active"))
          .collect(),
        ctx.db
          .query("notifications")
          .withIndex("by_society", (q) => q.eq("societyId", s._id))
          .order("desc")
          .take(200),
      ]);

      const alreadyNotified = new Set(
        recent.map((n) => `${n.kind}:${n.linkHref ?? ""}:${n.title}`),
      );

      for (const d of deadlines) {
        if (d.done) continue;
        const due = new Date(d.dueDate).getTime();
        if (due > cutoff) continue;
        const overdue = due < now;
        const key = `deadline:/deadlines:${d.title}`;
        if (alreadyNotified.has(key)) continue;
        await ctx.db.insert("notifications", {
          societyId: s._id,
          kind: "deadline",
          severity: overdue ? "err" : "warn",
          title: overdue ? `Overdue: ${d.title}` : `Due soon: ${d.title}`,
          body: `Category: ${d.category}. Due ${d.dueDate}.`,
          linkHref: "/deadlines",
          createdAtISO: new Date().toISOString(),
        });
      }

      for (const f of filings) {
        if (f.status === "Filed") continue;
        const due = new Date(f.dueDate).getTime();
        if (due > cutoff) continue;
        const overdue = due < now;
        const key = `filing:/filings:${f.kind} — ${f.periodLabel ?? f.dueDate}`;
        if (alreadyNotified.has(key)) continue;
        await ctx.db.insert("notifications", {
          societyId: s._id,
          kind: "filing",
          severity: overdue ? "err" : "warn",
          title: `${f.kind} — ${f.periodLabel ?? f.dueDate}`,
          body: overdue
            ? `Filing overdue as of ${f.dueDate}.`
            : `Filing due ${f.dueDate}.`,
          linkHref: "/filings",
          createdAtISO: new Date().toISOString(),
        });
      }

      for (const report of grantReports) {
        if (report.status === "Submitted") continue;
        const due = new Date(report.dueAtISO).getTime();
        if (due > cutoff) continue;
        const overdue = due < now;
        // Deep-link to the specific grant. Stored bare; normalized to
        // /app/grants/{id} on read. The dedup key uses the same value so it
        // stays consistent with what's stored.
        const linkHref = `/grants/${report.grantId}`;
        const key = `general:${linkHref}:${report.title}`;
        if (alreadyNotified.has(key)) continue;
        await ctx.db.insert("notifications", {
          societyId: s._id,
          kind: "general",
          severity: overdue ? "err" : "warn",
          title: overdue ? `Grant report overdue: ${report.title}` : `Grant report due soon: ${report.title}`,
          body: overdue
            ? `Grant reporting deadline passed on ${report.dueAtISO}.`
            : `Grant reporting deadline is ${report.dueAtISO}.`,
          linkHref,
          createdAtISO: new Date().toISOString(),
        });
      }

      for (const screening of screenings) {
        if (!screening.expiresAtISO) continue;
        const due = new Date(screening.expiresAtISO).getTime();
        if (due > cutoff) continue;
        const overdue = due < now;
        const key = `general:/volunteers:${screening.kind}`;
        if (alreadyNotified.has(key)) continue;
        await ctx.db.insert("notifications", {
          societyId: s._id,
          kind: "general",
          severity: overdue ? "err" : "warn",
          title: overdue
            ? `Volunteer screening expired: ${screening.kind}`
            : `Volunteer screening expiring soon: ${screening.kind}`,
          body: overdue
            ? `A volunteer screening deadline passed on ${screening.expiresAtISO}.`
            : `A volunteer screening expires on ${screening.expiresAtISO}.`,
          linkHref: "/volunteers",
          createdAtISO: new Date().toISOString(),
        });
      }

      for (const commitment of commitments) {
        if (!commitment.nextDueDate || commitment.status === "Closed" || commitment.status === "Paused") continue;
        const due = new Date(commitment.nextDueDate).getTime();
        const commitmentCutoff = now + Math.max(14, commitment.noticeLeadDays ?? 0) * 24 * 60 * 60 * 1000;
        if (due > commitmentCutoff) continue;
        const overdue = due < now;
        const title = overdue
          ? `Commitment overdue: ${commitment.title}`
          : `Commitment due soon: ${commitment.title}`;
        const key = `general:/app/commitments:${title}`;
        if (alreadyNotified.has(key)) continue;
        await ctx.db.insert("notifications", {
          societyId: s._id,
          kind: "general",
          severity: overdue ? "err" : "warn",
          title,
          body: overdue
            ? `Commitment deadline passed on ${commitment.nextDueDate}.`
            : `Commitment deadline is ${commitment.nextDueDate}${commitment.noticeLeadDays ? `; lead time is ${commitment.noticeLeadDays} days.` : "."}`,
          linkHref: "/app/commitments",
          createdAtISO: new Date().toISOString(),
        });
      }

      // Director mandates: a board term needs more runway than a 14-day filing,
      // so flag terms ending within ~60 days (Corporify's "be prepared for the
      // AGM"). Re-election planning lives on /app/directors.
      const termCutoff = now + TERM_EXPIRY_LEAD_DAYS * 24 * 60 * 60 * 1000;
      for (const director of activeDirectors) {
        if (!director.termEnd) continue;
        const due = new Date(director.termEnd).getTime();
        if (Number.isNaN(due) || due > termCutoff) continue;
        const overdue = due < now;
        const name = `${director.firstName} ${director.lastName}`.trim();
        const title = overdue
          ? `Director term expired: ${name}`
          : `Director term expiring soon: ${name}`;
        const key = `governance:/app/directors:${title}`;
        if (alreadyNotified.has(key)) continue;
        await ctx.db.insert("notifications", {
          societyId: s._id,
          kind: "governance",
          severity: overdue ? "err" : "warn",
          title,
          body: overdue
            ? `${director.position} term ended ${director.termEnd}. Re-elect or update the register before the AGM.`
            : `${director.position} term ends ${director.termEnd}. Plan the re-election for the AGM.`,
          linkHref: "/app/directors",
          createdAtISO: new Date().toISOString(),
        });
      }
    }
  },
});

/**
 * Does a (channel, kind) pair pass a user's notification prefs? An exact
 * (channel, kind) row wins; otherwise a (channel, "all") row; otherwise the
 * channel's default. Email defaults ON (opt-out per kind); SMS defaults OFF
 * (opt-in) so the daily cron never texts someone who never asked.
 */
function digestAllows(
  prefs: Array<{ channel: string; kind: string; enabled: boolean }>,
  channel: string,
  kind: string,
): boolean {
  const exact = prefs.find((p) => p.channel === channel && p.kind === kind);
  if (exact) return exact.enabled;
  const wildcard = prefs.find((p) => p.channel === channel && p.kind === "all");
  if (wildcard) return wildcard.enabled;
  return channel === "email";
}

// Action: bundle digest email + SMS for anyone who wants them. Per-user, the
// open items are filtered by that user's per-kind prefs for each channel.
export const sendDigest = action({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const [users, notifications] = await Promise.all([
      ctx.runQuery(api.users.list, { societyId }),
      ctx.runQuery(api.notifications.list, { societyId, limit: 50, unreadOnly: true }),
    ]);
    if (notifications.length === 0) return { emailsSent: 0, smsSent: 0 };

    // Reach delivery providers through the injected capability bag instead of
    // importing them directly. A runtime without email/sms wired gets a
    // structured CAPABILITY_UNAVAILABLE rather than a silent send.
    const capabilities = buildConvexCapabilities();
    let emailsSent = 0;
    let smsSent = 0;
    for (const u of users) {
      if (u.status !== "Active") continue;
      const prefs = await ctx.runQuery(api.notifications.listPrefs, { userId: u._id });

      const emailItems = notifications.filter((n: any) => digestAllows(prefs, "email", n.kind));
      if (emailItems.length > 0 && u.email) {
        const lines = emailItems
          .slice(0, 10)
          .map((n: any) => `• [${n.severity.toUpperCase()}] ${n.title}`)
          .join("\n");
        await capabilities.email.sendEmail({
          to: u.email,
          subject: `Societyer digest — ${emailItems.length} open item${emailItems.length === 1 ? "" : "s"}`,
          text: `Hi ${u.displayName},\n\n${lines}\n\nOpen Societyer to review.`,
          tag: "digest",
        });
        emailsSent += 1;
      }

      // SMS is opt-in: needs a phone AND an explicitly-enabled sms pref.
      const smsOptedIn = prefs.some((p: any) => p.channel === "sms" && p.enabled);
      const smsItems = notifications.filter((n: any) => digestAllows(prefs, "sms", n.kind));
      if (smsOptedIn && u.phone && smsItems.length > 0) {
        const top = smsItems.slice(0, 3).map((n: any) => n.title).join("; ");
        await capabilities.sms.sendSms({
          to: u.phone,
          body: `Societyer: ${smsItems.length} open item${smsItems.length === 1 ? "" : "s"}. ${top}`,
          tag: "digest",
        });
        smsSent += 1;
      }
    }
    return { emailsSent, smsSent };
  },
});

// Cron entry: run the digest for every society (the public action is per-entity).
export const sendDailyDigests = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const societies = await ctx.runQuery(api.society.list, {});
    let emailsSent = 0;
    let smsSent = 0;
    for (const s of societies) {
      const r = await ctx.runAction(api.notifications.sendDigest, { societyId: s._id });
      emailsSent += r.emailsSent ?? 0;
      smsSent += r.smsSent ?? 0;
    }
    return { societies: societies.length, emailsSent, smsSent };
  },
});
