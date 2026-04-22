import { v } from "convex/values";
import { query, mutation, action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { sendEmail } from "./providers/email";

export const list = query({
  args: {
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { societyId, userId, limit, unreadOnly }) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 100);
    return rows.filter((r) => {
      if (userId && r.userId && r.userId !== userId) return false;
      if (unreadOnly && r.readAt) return false;
      return true;
    });
  },
});

export const unreadCount = query({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { societyId, userId }) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(200);
    return rows.filter((r) => {
      if (r.readAt) return false;
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
  handler: async (ctx, args): Promise<Id<"notifications">> => {
    return await ctx.db.insert("notifications", {
      ...args,
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const markRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { readAt: new Date().toISOString() });
  },
});

export const markAllRead = mutation({
  args: { societyId: v.id("societies"), userId: v.optional(v.id("users")) },
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

export const listPrefs = query({
  args: { userId: v.id("users") },
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
  handler: async (ctx, { societyId }) => {
    const societies = societyId
      ? [await ctx.db.get(societyId)]
      : await ctx.db.query("societies").collect();

    const now = Date.now();
    const cutoff = now + 14 * 24 * 60 * 60 * 1000;

    for (const s of societies) {
      if (!s) continue;

      const [deadlines, filings, grantReports, screenings, commitments, recent] = await Promise.all([
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
        const key = `general:/grants:${report.title}`;
        if (alreadyNotified.has(key)) continue;
        await ctx.db.insert("notifications", {
          societyId: s._id,
          kind: "general",
          severity: overdue ? "err" : "warn",
          title: overdue ? `Grant report overdue: ${report.title}` : `Grant report due soon: ${report.title}`,
          body: overdue
            ? `Grant reporting deadline passed on ${report.dueAtISO}.`
            : `Grant reporting deadline is ${report.dueAtISO}.`,
          linkHref: "/grants",
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
    }
  },
});

// Action: bundle digest emails for anyone who wants them.
export const sendDigest = action({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const users = await ctx.runQuery(api.users.list, { societyId });
    const notifications = await ctx.runQuery(api.notifications.list, {
      societyId,
      limit: 50,
      unreadOnly: true,
    });
    if (notifications.length === 0) return { sent: 0 };

    const lines = notifications
      .slice(0, 10)
      .map((n: any) => `• [${n.severity.toUpperCase()}] ${n.title}`)
      .join("\n");

    let sent = 0;
    for (const u of users) {
      if (u.status !== "Active") continue;
      const prefs = await ctx.runQuery(api.notifications.listPrefs, {
        userId: u._id,
      });
      const allowEmail = prefs.length === 0
        ? true
        : prefs.some((p: any) => p.channel === "email" && p.enabled);
      if (!allowEmail) continue;
      await sendEmail({
        to: u.email,
        subject: `Societyer digest — ${notifications.length} open item${notifications.length === 1 ? "" : "s"}`,
        text: `Hi ${u.displayName},\n\n${lines}\n\nOpen Societyer to review.`,
        tag: "digest",
      });
      sent += 1;
    }
    return { sent };
  },
});
