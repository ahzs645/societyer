/**
 * PORTABLE FUNCTIONS: the notifications domain (list / unreadCount / create /
 * remove / removeAllDismissed / listPrefs / upsertPref).
 *
 * Pure `ctx.db` reads and writes over the `notifications`/`notificationPrefs`
 * tables. Each handler runs unchanged on hosted Convex, the local Dexie runtime,
 * and the convex-test oracle. The bell-state mutations (dismiss / dismissAll /
 * markRead / markAllRead / snooze) are pending; the crons (purgeDismissed /
 * scanUpcoming) and the digest action stay on Convex.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

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

export async function notificationsList(
  ctx: PortableQueryCtx,
  {
    societyId,
    userId,
    limit,
    unreadOnly,
    includeDismissed,
  }: {
    societyId: string;
    userId?: string;
    limit?: number;
    unreadOnly?: boolean;
    includeDismissed?: boolean;
  },
) {
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
    .map((r: Record<string, any>) => ({ ...r, linkHref: normalizeNotificationLink(r.linkHref) }));
}

export async function notificationsUnreadCount(
  ctx: PortableQueryCtx,
  { societyId, userId }: { societyId: string; userId?: string },
) {
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
}

export async function notificationCreate(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    userId?: string;
    kind: string;
    severity: string;
    title: string;
    body?: string;
    linkHref?: string;
  },
): Promise<string> {
  return await ctx.db.insert("notifications", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
}

/** Permanently delete a single notification now, without waiting for the
 * retention purge. Used by the "Delete permanently" action on the
 * Notifications page (Dismissed tab). */
export async function notificationRemove(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

/** Permanently delete every dismissed notification for this user/society now. */
export async function notificationRemoveAllDismissed(
  ctx: PortableMutationCtx,
  { societyId, userId }: { societyId: string; userId?: string },
) {
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
}

export async function notificationsListPrefs(ctx: PortableQueryCtx, { userId }: { userId: string }) {
  return ctx.db
    .query("notificationPrefs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

export async function notificationUpsertPref(
  ctx: PortableMutationCtx,
  args: { userId: string; channel: string; kind: string; enabled: boolean },
) {
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
}
