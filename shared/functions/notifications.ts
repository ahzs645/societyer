/**
 * PORTABLE FUNCTIONS: the notifications domain (list / unreadCount / create /
 * remove / removeAllDismissed / listPrefs / upsertPref).
 *
 * Pure `ctx.db` reads and writes over notifications, personal receipts and
 * preferences. Each handler runs unchanged on hosted Convex, the local Dexie runtime,
 * and the convex-test oracle. The bell-state mutations (dismiss / dismissAll /
 * markRead / markAllRead / snooze) are ported here too; the crons
 * (purgeDismissed / scanUpcoming) and the digest action stay on Convex.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireRolePortable, requireSocietyMembership } from "./access";
import { hasPermission, requirePermissionPortable, type Permission } from "./permissions";
import { fiscalWindow } from "./treasury";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import { isInternalTransfer } from "../transferCategories";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_RULES,
  clampRuleValue,
  digestEnabled,
  isNotificationChannel,
  isPreferenceKind,
  notificationKind,
  notificationRule,
  prefAllows,
  preferenceKindFor,
  resolveNotificationRules,
  transactionNeedsAttention,
  type DigestCadence,
  type NotificationPrefRow,
  type NotificationRuleId,
  type ResolvedNotificationRule,
} from "../notificationCatalog";

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

type ViewerRow = { _id: string; role?: unknown };
const INBOX_WINDOW = 200;
type NotificationRow = Record<string, any> & { _id: string; societyId: string; userId?: string };

/** Inbox arguments are compatibility hints, never authority to impersonate another recipient. */
async function notificationViewer(ctx: PortableQueryCtx, societyId: string, userId?: string) {
  const viewer = await requireSocietyMembership(ctx, societyId);
  if (userId && userId !== viewer._id) throw new Error("Notification recipient does not match the current user.");
  return viewer;
}

function notificationAudienceAllows(viewer: ViewerRow, row: Record<string, any>): boolean {
  if (row.userId) return row.userId === viewer._id;
  return receivableKinds(viewer.role).has(preferenceKindFor(row));
}

async function requireNotificationForViewer(ctx: PortableQueryCtx, id: string) {
  const row = await requireOwnedRow(ctx, "notifications", id);
  const viewer = await notificationViewer(ctx, row.societyId);
  if (!notificationAudienceAllows(viewer, row)) throw new Error("notifications not found.");
  const visible = await notificationForUser(ctx, row, viewer._id);
  if (visible.removedAt) throw new Error("notifications not found.");
  return { row: visible, viewer };
}

/** A fixed recent inbox window; another user's private notices cannot crowd it out. */
async function notificationCandidates(ctx: PortableQueryCtx, societyId: string, userId: string, broadcastRows?: NotificationRow[]) {
  const [broadcast, personal] = await Promise.all([
    broadcastRows ?? ctx.db.query<NotificationRow>("notifications").withIndex("by_society_user", q => q.eq("societyId", societyId).eq("userId", undefined)).order("desc").take(INBOX_WINDOW),
    isSyntheticOwner(userId) ? [] : ctx.db.query<NotificationRow>("notifications").withIndex("by_society_user", q => q.eq("societyId", societyId).eq("userId", userId)).order("desc").take(INBOX_WINDOW),
  ]);
  return [...broadcast, ...personal].sort((a, b) => Number(b._creationTime ?? 0) - Number(a._creationTime ?? 0) || String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")) || b._id.localeCompare(a._id)).slice(0, INBOX_WINDOW);
}

async function receiptFor(ctx: PortableQueryCtx, row: NotificationRow, userId: string) {
  if (row.userId || isSyntheticOwner(userId)) return null;
  const receipt = await ctx.db.query("notificationReceipts").withIndex("by_user_notification", q => q.eq("userId", userId).eq("notificationId", row._id)).unique();
  return receipt?.societyId === row.societyId ? receipt : null;
}

/** An existing receipt owns all state fields, including an explicitly cleared snooze. */
async function notificationForUser(ctx: PortableQueryCtx, row: NotificationRow, userId: string): Promise<NotificationRow> {
  const receipt = await receiptFor(ctx, row, userId);
  if (!receipt) return row;
  return { ...row, readAt: receipt.readAt, dismissedAt: receipt.dismissedAt, snoozedUntilISO: receipt.snoozedUntilISO, removedAt: receipt.removedAt };
}

async function inboxForUser(ctx: PortableQueryCtx, societyId: string, userId: string, broadcastRows?: NotificationRow[]) {
  const candidates = await notificationCandidates(ctx, societyId, userId, broadcastRows);
  return Promise.all(candidates.map(row => notificationForUser(ctx, row, userId)));
}

async function patchNotificationState(ctx: PortableMutationCtx, row: NotificationRow, userId: string, patch: Record<string, any>) {
  // A targeted row has exactly one recipient. A synthetic owner represents one
  // person holding a local file and cannot create a hosted user foreign key.
  if (row.userId || isSyntheticOwner(userId)) {
    if (patch.removedAt) await ctx.db.delete(row._id);
    else await ctx.db.patch(row._id, patch);
    return;
  }
  const receipt = await receiptFor(ctx, row, userId);
  if (receipt) {
    await ctx.db.patch(receipt._id, patch);
    return;
  }
  // Legacy broadcast flags remain the baseline until this person first acts.
  // Copy the complete state once; later edits never fall back to stale flags.
  await ctx.db.insert("notificationReceipts", {
    societyId: row.societyId, userId, notificationId: row._id,
    readAt: row.readAt, dismissedAt: row.dismissedAt, snoozedUntilISO: row.snoozedUntilISO,
    ...patch,
  });
}

/** Stored preference rows for one person (none for a synthetic local owner). */
async function prefsFor(ctx: PortableQueryCtx, userId: string): Promise<NotificationPrefRow[]> {
  if (userId.startsWith("local-workspace-owner:")) return [];
  const rows = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.map((row: Record<string, any>) => ({ channel: String(row.channel), kind: String(row.kind), enabled: row.enabled === true }));
}

/** Kinds this role is allowed to receive at all. */
function receivableKinds(role: unknown): Set<string> {
  return new Set(NOTIFICATION_KINDS.filter((kind) => hasPermission(String(role ?? ""), kind.permission)).map((kind) => kind.id));
}

/**
 * Which stored rows reach this person in the app: a workspace-wide row only
 * when their role may see that kind, and any row only when they haven't
 * turned the kind off for the in-app channel. A row addressed to them by
 * userId skips the permission check (the sender already chose them).
 */
async function viewerReceives(ctx: PortableQueryCtx, viewer: ViewerRow) {
  const prefs = await prefsFor(ctx, viewer._id);
  const kinds = receivableKinds(viewer.role);
  return (row: Record<string, any>) => {
    const kind = preferenceKindFor(row);
    if (row.userId && row.userId !== viewer._id) return false;
    if (!(row.userId && row.userId === viewer._id) && !kinds.has(kind)) return false;
    return prefAllows(prefs, "inApp", kind);
  };
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
  const viewer = await notificationViewer(ctx, societyId, userId);
  const receives = await viewerReceives(ctx, viewer);
  const nowISO = new Date().toISOString();
  const rows = await inboxForUser(ctx, societyId, viewer._id);
  const requestedLimit = Number.isFinite(limit) ? Math.max(0, Math.min(INBOX_WINDOW, Math.floor(limit!))) : 100;
  return rows
    .filter((r) => {
      if (r.removedAt) return false;
      if (userId && r.userId && r.userId !== userId) return false;
      if (!receives(r)) return false;
      if (unreadOnly && r.readAt) return false;
      if (!includeDismissed && r.dismissedAt) return false;
      // Snoozed rows leave the bell until their time passes; the full page
      // (includeDismissed) still shows them so the user can un-snooze.
      if (!includeDismissed && r.snoozedUntilISO && r.snoozedUntilISO > nowISO) return false;
      return true;
    })
    .slice(0, requestedLimit)
    .map((r: Record<string, any>) => ({ ...r, linkHref: normalizeNotificationLink(r.linkHref) }));
}

export async function notificationsUnreadCount(
  ctx: PortableQueryCtx,
  { societyId, userId }: { societyId: string; userId?: string },
) {
  const viewer = await notificationViewer(ctx, societyId, userId);
  const receives = await viewerReceives(ctx, viewer);
  const nowISO = new Date().toISOString();
  const rows = await inboxForUser(ctx, societyId, viewer._id);
  return rows.filter((r) => {
    if (r.removedAt) return false;
    if (r.readAt) return false;
    if (!receives(r)) return false;
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
  await requireSocietyMembership(ctx, args.societyId);
  if (args.userId) await getOwned(ctx, "users", args.userId, args.societyId);
  return await ctx.db.insert("notifications", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
}

export async function notificationMarkRead(ctx: PortableMutationCtx, { id }: { id: string }) {
  const { row, viewer } = await requireNotificationForViewer(ctx, id);
  await patchNotificationState(ctx, row, viewer._id, { readAt: new Date().toISOString() });
}

export async function notificationMarkAllRead(
  ctx: PortableMutationCtx,
  { societyId, userId }: { societyId: string; userId?: string },
) {
  const viewer = await notificationViewer(ctx, societyId, userId);
  const receives = await viewerReceives(ctx, viewer);
  const rows = await inboxForUser(ctx, societyId, viewer._id);
  const now = new Date().toISOString();
  for (const r of rows) {
    if (r.readAt || r.removedAt) continue;
    if (!receives(r)) continue;
    await patchNotificationState(ctx, r, viewer._id, { readAt: now });
  }
}

/** Clear a single notification from the bell. Stamps dismissedAt (and readAt
 * if not already read) so it leaves the bell + unread count immediately, but
 * the row survives on the Notifications page until `purgeDismissed` runs. */
export async function notificationDismiss(ctx: PortableMutationCtx, { id }: { id: string }) {
  const now = new Date().toISOString();
  const { row: existing, viewer } = await requireNotificationForViewer(ctx, id);
  await patchNotificationState(ctx, existing, viewer._id, {
    dismissedAt: now,
    readAt: existing?.readAt ?? now,
  });
}

/** Hide a notification from the bell until `untilISO` (null un-snoozes it). The
 *  row resurfaces automatically once the time passes — no purge needed. */
export async function notificationSnooze(
  ctx: PortableMutationCtx,
  { id, untilISO }: { id: string; untilISO: string | null },
) {
  const { row, viewer } = await requireNotificationForViewer(ctx, id);
  await patchNotificationState(ctx, row, viewer._id, { snoozedUntilISO: untilISO ?? undefined });
}

/** Clear non-dismissed notifications in this person's recent inbox window. */
export async function notificationDismissAll(
  ctx: PortableMutationCtx,
  { societyId, userId }: { societyId: string; userId?: string },
) {
  const viewer = await notificationViewer(ctx, societyId, userId);
  const receives = await viewerReceives(ctx, viewer);
  const rows = await inboxForUser(ctx, societyId, viewer._id);
  const now = new Date().toISOString();
  for (const r of rows) {
    if (r.dismissedAt || r.removedAt) continue;
    if (!receives(r)) continue;
    await patchNotificationState(ctx, r, viewer._id, { dismissedAt: now, readAt: r.readAt ?? now });
  }
}

/** Permanently remove a notification from this person's inbox. Broadcasts
 * retain a receipt tombstone so the shared notice survives for other people. */
export async function notificationRemove(ctx: PortableMutationCtx, { id }: { id: string }) {
  const { row, viewer } = await requireNotificationForViewer(ctx, id);
  await patchNotificationState(ctx, row, viewer._id, { removedAt: new Date().toISOString() });
}

/** Remove dismissed notifications in this person's recent inbox window. */
export async function notificationRemoveAllDismissed(
  ctx: PortableMutationCtx,
  { societyId, userId }: { societyId: string; userId?: string },
) {
  const viewer = await notificationViewer(ctx, societyId, userId);
  const receives = await viewerReceives(ctx, viewer);
  const rows = await inboxForUser(ctx, societyId, viewer._id);
  let removed = 0;
  for (const r of rows) {
    if (!r.dismissedAt || r.removedAt) continue;
    if (!receives(r)) continue;
    await patchNotificationState(ctx, r, viewer._id, { removedAt: new Date().toISOString() });
    removed++;
  }
  return { removed };
}

/** Someone else's preferences are readable and writable only by an admin. */
async function requirePrefsAccess(ctx: PortableQueryCtx, userId: string) {
  const target = await requireOwnedRow(ctx, "users", userId);
  const viewer = await requireSocietyMembership(ctx, target.societyId);
  if (viewer._id !== userId) await requireRolePortable(ctx, { societyId: target.societyId, required: "Admin" });
  return target;
}

export async function notificationsListPrefs(ctx: PortableQueryCtx, { userId }: { userId: string }) {
  await requirePrefsAccess(ctx, userId);
  return ctx.db
    .query("notificationPrefs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

async function upsertPrefRow(ctx: PortableMutationCtx, args: { userId: string; channel: string; kind: string; enabled: boolean }) {
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

export async function notificationUpsertPref(
  ctx: PortableMutationCtx,
  args: { userId: string; channel: string; kind: string; enabled: boolean },
) {
  await requirePrefsAccess(ctx, args.userId);
  return upsertPrefRow(ctx, args);
}

// ---------------------------------------------------------------------------
// Notification settings (the current person's matrix + workspace thresholds)
// ---------------------------------------------------------------------------

function isSyntheticOwner(userId: string) {
  return userId.startsWith("local-workspace-owner:");
}

/**
 * Turn one (channel, kind) switch on or off for the signed-in person. The
 * person is always the current principal, never a caller-supplied id, so
 * anyone who can read notifications can manage their own.
 */
export async function notificationSetMyPref(
  ctx: PortableMutationCtx,
  args: { societyId: string; channel: string; kind: string; enabled: boolean },
) {
  const viewer = await requireSocietyMembership(ctx, args.societyId);
  if (!hasPermission(String(viewer.role ?? ""), "tasks:read")) throw new Error("Permission tasks:read required.");
  if (isSyntheticOwner(viewer._id)) throw new Error("Choose who you are in this workspace before saving notification settings.");
  if (!isNotificationChannel(args.channel)) throw new Error("Unknown notification channel.");
  if (!isPreferenceKind(args.kind)) throw new Error("Unknown notification kind.");
  if (args.kind.startsWith("digest:") && args.channel !== "email") throw new Error("Digests are sent by email.");
  const def = notificationKind(args.kind);
  if (def && !hasPermission(String(viewer.role ?? ""), def.permission)) throw new Error("You don't receive this kind of notification.");
  return upsertPrefRow(ctx, { userId: viewer._id, channel: args.channel, kind: args.kind, enabled: args.enabled });
}

async function ruleRows(ctx: PortableQueryCtx, societyId: string) {
  return ctx.db
    .query("notificationRules")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

async function resolvedRules(ctx: PortableQueryCtx, societyId: string) {
  const rows = await ruleRows(ctx, societyId);
  return resolveNotificationRules(rows.map((row: Record<string, any>) => ({
    rule: String(row.rule),
    enabled: row.enabled === true,
    value: Number(row.value),
    accountId: row.accountId,
  })));
}

/** Change one workspace threshold. Finance thresholds need finance edit access. */
export async function notificationSetRule(
  ctx: PortableMutationCtx,
  args: { societyId: string; rule: string; enabled: boolean; value: number; accountId?: string | null },
) {
  const def = notificationRule(args.rule);
  if (!def) throw new Error("Unknown alert threshold.");
  const actor = await requirePermissionPortable(ctx, args.societyId, def.writePermission);
  if (args.accountId) {
    if (def.id !== "low_balance") throw new Error("Only the low-balance alert watches an account.");
    await getOwned(ctx, "financialAccounts", args.accountId, args.societyId);
  }
  const value = clampRuleValue(def, Number(args.value));
  const rows = await ruleRows(ctx, args.societyId);
  const existing = rows.find((row: Record<string, any>) => row.rule === def.id);
  const patch = {
    enabled: args.enabled === true,
    value,
    accountId: def.id === "low_balance" ? args.accountId ?? undefined : undefined,
    updatedAtISO: new Date().toISOString(),
    updatedByUserId: isSyntheticOwner(actor._id) ? undefined : actor._id,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("notificationRules", { societyId: args.societyId, rule: def.id, ...patch });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date in the organization's own time zone (not the UTC date). */
function organizationToday(organization: Record<string, any> | null, nowISO: string) {
  return resolutionCalendarDate(nowISO, resolutionTimeZone(organization)) ?? nowISO.slice(0, 10);
}

function formatWholeDollars(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-CA")}`;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The fiscal year containing `today`, as its "YYYY" end-year label. */
function currentFiscalYearLabel(today: string, fiscalYearEnd: unknown) {
  const fye = /^\d{2}-\d{2}$/.test(String(fiscalYearEnd ?? "")) ? String(fiscalYearEnd) : "12-31";
  const year = Number(today.slice(0, 4));
  return today.slice(5) > fye ? String(year + 1) : String(year);
}

type BudgetStanding = { category: string; fiscalYear: string; plannedCents: number; spentCents: number; percent: number };

/**
 * Expense budget lines for the fiscal year containing today, with what has
 * been spent so far. A line counts as an expense line when money out of its
 * category outweighs money in; revenue lines never raise a spending alert.
 */
async function currentBudgetStanding(ctx: PortableQueryCtx, societyId: string, society: Record<string, any> | null, today: string): Promise<BudgetStanding[]> {
  const budgets = await ctx.db
    .query("budgets")
    .withIndex("by_society_fy", (q) => q.eq("societyId", societyId))
    .collect();
  const current = budgets.filter((row: Record<string, any>) => {
    if (row.programCode || row.accountId || !(Number(row.plannedCents) > 0)) return false;
    const window = fiscalWindow(String(row.fiscalYear), society?.fiscalYearEnd);
    return window.start <= today && today <= window.end;
  });
  if (!current.length) return [];
  const label = String(current[0].fiscalYear);
  const { start, end } = fiscalWindow(label, society?.fiscalYearEnd);
  const txns = await ctx.db
    .query("financialTransactions")
    .withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("date", start).lte("date", end))
    .collect();
  const out = new Map<string, { spent: number; received: number }>();
  for (const txn of txns) {
    if (isInternalTransfer(txn)) continue;
    const category = String(txn.category ?? "Uncategorized");
    const entry = out.get(category) ?? { spent: 0, received: 0 };
    const amount = Number(txn.amountCents) || 0;
    if (amount < 0) entry.spent += -amount;
    else entry.received += amount;
    out.set(category, entry);
  }
  return current
    .filter((row: Record<string, any>) => String(row.fiscalYear) === label)
    .flatMap((row: Record<string, any>) => {
      const totals = out.get(String(row.category));
      if (!totals || totals.spent <= totals.received) return [];
      const planned = Number(row.plannedCents);
      return [{ category: String(row.category), fiscalYear: label, plannedCents: planned, spentCents: totals.spent, percent: Math.round((totals.spent / planned) * 100) }];
    });
}

/** The watched bank account: the chosen one, else the first unrestricted bank account. */
function watchedAccount(accounts: Record<string, any>[], accountId?: string) {
  const banks = accounts.filter((account) => account.accountType === "Bank");
  if (accountId) return banks.find((account) => account._id === accountId);
  return banks.find((account) => !account.isRestricted && account.subtype === "cash")
    ?? banks.find((account) => !account.isRestricted)
    ?? banks[0];
}

function claimSubmittedAt(claim: Record<string, any>) {
  return String(claim.submittedAtISO ?? claim.updatedAtISO ?? claim.createdAtISO ?? "");
}

type PendingAlert = {
  kind: string;
  severity: "info" | "warn" | "err";
  title: string;
  body: string;
  linkHref: string;
  /** Raise again after this many days if the condition still holds. */
  repeatAfterDays?: number;
};

/** What each threshold currently matches, for the settings page. */
export type AlertPreview = Record<NotificationRuleId, { matches: number; detail?: string }>;

/**
 * Evaluate every alert source for one workspace: deadlines, filings, grant
 * reports, volunteer screenings, commitments, director terms, and the
 * workspace thresholds (budget line %, low balance, claims waiting).
 */
async function collectAlerts(ctx: PortableQueryCtx, societyId: string, nowMs: number) {
  const society = (await ctx.db.get(societyId, "societies")) as Record<string, any> | null;
  const rules = await resolvedRules(ctx, societyId);
  const today = organizationToday(society, new Date(nowMs).toISOString());
  const leadDays = rules.deadline_lead.enabled ? rules.deadline_lead.value : 0;
  const cutoff = nowMs + leadDays * DAY_MS;
  // Board mandates get a longer runway than ordinary deadlines: re-election
  // has to be planned into the annual meeting agenda.
  const termCutoff = nowMs + Math.max(60, leadDays) * DAY_MS;

  const byIndex = (table: string) => ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const [deadlines, filings, grantReports, screenings, commitments, activeDirectors, accounts, submittedClaims] = await Promise.all([
    byIndex("deadlines"),
    byIndex("filings"),
    byIndex("grantReports"),
    byIndex("volunteerScreenings"),
    byIndex("commitments"),
    ctx.db.query("directors").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
    byIndex("financialAccounts"),
    ctx.db.query("expenseReports").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Submitted")).collect(),
  ]);

  const alerts: PendingAlert[] = [];
  let deadlineMatches = 0;
  const dueState = (iso: string, limit = cutoff) => {
    const due = new Date(iso).getTime();
    if (Number.isNaN(due) || due > limit) return null;
    return { overdue: due < nowMs };
  };

  for (const d of deadlines) {
    if (d.done || d.status === "complete" || d.status === "closed") continue;
    const state = dueState(d.dueDate);
    if (!state) continue;
    deadlineMatches++;
    alerts.push({
      kind: "deadline",
      severity: state.overdue ? "err" : "warn",
      title: state.overdue ? `Overdue: ${d.title}` : `Due soon: ${d.title}`,
      body: `Category: ${d.category}. Due ${d.dueDate}.`,
      linkHref: "/deadlines",
    });
  }

  for (const f of filings) {
    if (f.status === "Filed") continue;
    const state = dueState(f.dueDate);
    if (!state) continue;
    deadlineMatches++;
    alerts.push({
      kind: "filing",
      severity: state.overdue ? "err" : "warn",
      title: `${f.kind} — ${f.periodLabel ?? f.dueDate}`,
      body: state.overdue ? `Filing overdue as of ${f.dueDate}.` : `Filing due ${f.dueDate}.`,
      linkHref: "/filings",
    });
  }

  for (const report of grantReports) {
    if (report.status === "Submitted") continue;
    const state = dueState(report.dueAtISO);
    if (!state) continue;
    deadlineMatches++;
    // Deep-link to the specific grant. Stored bare; normalized to
    // /app/grants/{id} on read.
    alerts.push({
      kind: "grant",
      severity: state.overdue ? "err" : "warn",
      title: state.overdue ? `Grant report overdue: ${report.title}` : `Grant report due soon: ${report.title}`,
      body: state.overdue ? `Grant reporting deadline passed on ${report.dueAtISO}.` : `Grant reporting deadline is ${report.dueAtISO}.`,
      linkHref: `/grants/${report.grantId}`,
    });
  }

  for (const screening of screenings) {
    if (!screening.expiresAtISO) continue;
    const state = dueState(screening.expiresAtISO);
    if (!state) continue;
    alerts.push({
      kind: "volunteer",
      severity: state.overdue ? "err" : "warn",
      title: state.overdue ? `Volunteer screening expired: ${screening.kind}` : `Volunteer screening expiring soon: ${screening.kind}`,
      body: state.overdue
        ? `A volunteer screening deadline passed on ${screening.expiresAtISO}.`
        : `A volunteer screening expires on ${screening.expiresAtISO}.`,
      linkHref: "/volunteers",
    });
  }

  for (const commitment of commitments) {
    if (!commitment.nextDueDate || commitment.status === "Closed" || commitment.status === "Paused") continue;
    const state = dueState(commitment.nextDueDate, nowMs + Math.max(leadDays, commitment.noticeLeadDays ?? 0) * DAY_MS);
    if (!state) continue;
    alerts.push({
      kind: "commitment",
      severity: state.overdue ? "err" : "warn",
      title: state.overdue ? `Commitment overdue: ${commitment.title}` : `Commitment due soon: ${commitment.title}`,
      body: state.overdue
        ? `Commitment deadline passed on ${commitment.nextDueDate}.`
        : `Commitment deadline is ${commitment.nextDueDate}${commitment.noticeLeadDays ? `; lead time is ${commitment.noticeLeadDays} days.` : "."}`,
      linkHref: "/app/commitments",
    });
  }

  for (const director of activeDirectors) {
    if (!director.termEnd) continue;
    const state = dueState(director.termEnd, termCutoff);
    if (!state) continue;
    const name = `${director.firstName} ${director.lastName}`.trim();
    alerts.push({
      kind: "governance",
      severity: state.overdue ? "err" : "warn",
      title: state.overdue ? `Director term expired: ${name}` : `Director term expiring soon: ${name}`,
      body: state.overdue
        ? `${director.position} term ended ${director.termEnd}. Re-elect or update the register at the next annual meeting.`
        : `${director.position} term ends ${director.termEnd}. Plan the re-election for the next annual meeting.`,
      linkHref: "/app/directors",
    });
  }

  const preview: AlertPreview = {
    deadline_lead: { matches: deadlineMatches },
    budget_line: { matches: 0 },
    low_balance: { matches: 0 },
    claim_waiting: { matches: 0 },
  };

  // Budget lines: one alert when spending passes the threshold, and another
  // when the line goes over plan.
  const budgetRule = rules.budget_line;
  const standing = await currentBudgetStanding(ctx, societyId, society, today);
  const overThreshold = standing.filter((line) => line.percent >= budgetRule.value);
  preview.budget_line = {
    matches: overThreshold.length,
    detail: overThreshold.length ? overThreshold.slice(0, 3).map((line) => `${line.category} ${line.percent}%`).join(", ") : undefined,
  };
  if (budgetRule.enabled) {
    for (const line of overThreshold) {
      // The highest level reached: a line that crosses the threshold and
      // later goes over plan gets both alerts, one already over gets one.
      const over = budgetRule.value < 100 && line.percent >= 100;
      alerts.push({
        kind: "budget",
        severity: line.percent >= 100 ? "err" : "warn",
        title: over
          ? `${line.category} is over budget (FY ${line.fiscalYear})`
          : `${line.category} passed ${budgetRule.value}% of budget (FY ${line.fiscalYear})`,
        body: `Spent ${formatWholeDollars(line.spentCents)} of ${formatWholeDollars(line.plannedCents)} planned (${line.percent}%).`,
        linkHref: "/app/treasurer",
      });
    }
  }

  // Low balance on the watched bank account, repeated weekly while it stays low.
  const balanceRule = rules.low_balance;
  const account = watchedAccount(accounts, balanceRule.accountId);
  if (account) {
    const below = Number(account.balanceCents) < balanceRule.value;
    preview.low_balance = { matches: below ? 1 : 0, detail: `${account.name}: ${formatWholeDollars(Number(account.balanceCents))}` };
    if (balanceRule.enabled && below) {
      alerts.push({
        kind: "balance",
        severity: "warn",
        title: `${account.name} is below ${formatWholeDollars(balanceRule.value)}`,
        body: `The balance is ${formatWholeDollars(Number(account.balanceCents))}.`,
        linkHref: "/app/financials",
        repeatAfterDays: 7,
      });
    }
  }

  // Expense claims waiting for approval longer than the threshold.
  const claimRule = rules.claim_waiting;
  const waitingSince = nowMs - claimRule.value * DAY_MS;
  const waiting = submittedClaims.filter((claim: Record<string, any>) => {
    const at = Date.parse(claimSubmittedAt(claim));
    return Number.isFinite(at) && at <= waitingSince;
  });
  preview.claim_waiting = { matches: waiting.length };
  if (claimRule.enabled) {
    for (const claim of waiting) {
      const approvals = Array.isArray(claim.approvals) ? claim.approvals.length : 0;
      const required = Number(claim.requiredApprovals) || 1;
      alerts.push({
        kind: "approval",
        severity: "warn",
        title: `Claim waiting over ${plural(claimRule.value, "day")}: ${claim.title}`,
        body: `${claim.claimantName} submitted ${formatWholeDollars(Number(claim.amountCents))} on ${claimSubmittedAt(claim).slice(0, 10)}. ${approvals} of ${plural(required, "approval")} so far.`,
        linkHref: `/app/approvals?claim=${claim._id}`,
      });
    }
  }

  return { alerts, preview, rules };
}

/**
 * Raise any alert that hasn't been raised yet. Dedupe on preference kind +
 * link + title against the recent rows, so a re-run (or rows written under an
 * older kind) never duplicates; alerts with `repeatAfterDays` come back once
 * the earlier copy is that old.
 */
export async function scanSocietyAlerts(ctx: PortableMutationCtx, societyId: string, nowMs = Date.now()) {
  const { alerts } = await collectAlerts(ctx, societyId, nowMs);
  if (!alerts.length) return { created: 0 };
  const recent = await ctx.db
    .query("notifications")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(300);
  const lastRaised = new Map<string, string>();
  for (const row of recent) {
    const key = `${preferenceKindFor(row)}:${row.linkHref ?? ""}:${row.title}`;
    const at = String(row.createdAtISO ?? "");
    if (!lastRaised.has(key) || at > (lastRaised.get(key) ?? "")) lastRaised.set(key, at);
  }
  let created = 0;
  const nowISO = new Date(nowMs).toISOString();
  for (const alert of alerts) {
    const key = `${alert.kind}:${alert.linkHref}:${alert.title}`;
    const previous = lastRaised.get(key);
    if (previous) {
      if (!alert.repeatAfterDays) continue;
      if (Date.parse(previous) > nowMs - alert.repeatAfterDays * DAY_MS) continue;
    }
    await ctx.db.insert("notifications", {
      societyId,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      linkHref: alert.linkHref,
      createdAtISO: nowISO,
    });
    lastRaised.set(key, nowISO);
    created++;
  }
  return { created };
}

/**
 * Run the alert scan now for one workspace. The scheduled scan does this
 * twice a day on the server; the in-browser workspace calls it on load.
 */
export async function notificationEvaluateAlerts(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return scanSocietyAlerts(ctx, societyId);
}

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

type DigestUser = { _id: string; role?: unknown; displayName?: string; email?: string; phone?: string; status?: string };

/**
 * The weekly summary lines one person would get: unread items, what's due,
 * claims waiting for approval and transactions needing attention. Lines only
 * cover what the person's role can see.
 */
async function weeklySummaryLines(
  ctx: PortableQueryCtx,
  societyId: string,
  user: DigestUser,
  prefs: NotificationPrefRow[],
  unread: Record<string, any>[],
  nowMs: number,
) {
  const role = String(user.role ?? "");
  const can = (permission: Permission) => hasPermission(role, permission);
  const society = (await ctx.db.get(societyId, "societies")) as Record<string, any> | null;
  const rules = await resolvedRules(ctx, societyId);
  const lines: string[] = [];

  const kinds = receivableKinds(role);
  const mine = unread.filter((row) => {
    const kind = preferenceKindFor(row);
    if (row.userId && row.userId !== user._id) return false;
    return (row.userId === user._id || kinds.has(kind)) && prefAllows(prefs, "email", kind);
  });
  if (mine.length) lines.push(`${plural(mine.length, "unread notification")}.`);

  const leadDays = rules.deadline_lead.enabled ? rules.deadline_lead.value : 14;
  const horizon = nowMs + leadDays * DAY_MS;
  if (can("deadlines:read") || can("filings:read")) {
    let due = 0;
    let overdue = 0;
    const count = (iso: string) => {
      const at = new Date(iso).getTime();
      if (Number.isNaN(at) || at > horizon) return;
      if (at < nowMs) overdue++;
      else due++;
    };
    if (can("deadlines:read")) {
      for (const d of await ctx.db.query("deadlines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) {
        if (!(d.done || d.status === "complete" || d.status === "closed")) count(d.dueDate);
      }
    }
    if (can("filings:read")) {
      for (const f of await ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) {
        if (f.status !== "Filed") count(f.dueDate);
      }
    }
    if (due || overdue) {
      lines.push(`${plural(due, "deadline")} due in the next ${plural(leadDays, "day")}${overdue ? `, ${overdue} overdue` : ""}.`);
    }
  }

  if (can("financials:read")) {
    const claims = await ctx.db
      .query("expenseReports")
      .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Submitted"))
      .collect();
    if (claims.length) {
      const oldest = Math.min(...claims.map((claim: Record<string, any>) => Date.parse(claimSubmittedAt(claim))).filter(Number.isFinite));
      const days = Number.isFinite(oldest) ? Math.floor((nowMs - oldest) / DAY_MS) : 0;
      lines.push(`${plural(claims.length, "claim")} awaiting approval${days > 0 ? ` (oldest waiting ${plural(days, "day")})` : ""}.`);
    }

    const today = organizationToday(society, new Date(nowMs).toISOString());
    const { start } = fiscalWindow(currentFiscalYearLabel(today, society?.fiscalYearEnd), society?.fiscalYearEnd);
    const txns = await ctx.db
      .query("financialTransactions")
      .withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("date", start).lte("date", today))
      .collect();
    let uncategorized = 0;
    let missingReceipt = 0;
    let total = 0;
    for (const txn of txns) {
      if (isInternalTransfer(txn)) continue;
      const flags = transactionNeedsAttention(txn);
      if (flags.uncategorized) uncategorized++;
      if (flags.missingReceipt) missingReceipt++;
      if (flags.uncategorized || flags.missingReceipt) total++;
    }
    if (total) {
      const parts = [uncategorized ? `${uncategorized} uncategorized` : "", missingReceipt ? `${plural(missingReceipt, "missing receipt")}` : ""].filter(Boolean);
      lines.push(`${plural(total, "transaction")} ${total === 1 ? "needs" : "need"} attention this fiscal year: ${parts.join(", ")}.`);
    }
  }
  return lines;
}

async function unreadForDigest(ctx: PortableQueryCtx, societyId: string, userId: string, nowMs: number, broadcastRows?: NotificationRow[]) {
  const nowISO = new Date(nowMs).toISOString();
  const rows = await inboxForUser(ctx, societyId, userId, broadcastRows);
  return rows.filter((row) => !row.removedAt && !row.readAt && !row.dismissedAt && !(row.snoozedUntilISO && row.snoozedUntilISO > nowISO));
}

export type DigestRecipient = {
  userId: string;
  displayName: string;
  email?: string;
  phone?: string;
  emailLines: string[];
  emailCount: number;
  smsSummary?: string;
};

/**
 * Who gets a digest and what it says. Daily: unread items filtered by each
 * person's email (and opt-in text) switches. Weekly: the summary lines, for
 * people who turned the weekly summary on. Respects role permissions.
 */
export async function buildDigestPlan(ctx: PortableQueryCtx, societyId: string, cadence: DigestCadence, nowMs = Date.now()): Promise<DigestRecipient[]> {
  const [users, broadcast] = await Promise.all([
    ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<NotificationRow>("notifications").withIndex("by_society_user", q => q.eq("societyId", societyId).eq("userId", undefined)).order("desc").take(INBOX_WINDOW),
  ]);
  const plan: DigestRecipient[] = [];
  for (const user of users as DigestUser[]) {
    if (user.status && user.status !== "Active") continue;
    const prefs = await prefsFor(ctx, user._id);
    if (!digestEnabled(prefs, cadence)) continue;
    const unread = await unreadForDigest(ctx, societyId, user._id, nowMs, broadcast);
    const kinds = receivableKinds(user.role);
    const visible = unread.filter((row) => {
      if (row.userId && row.userId !== user._id) return false;
      return row.userId === user._id || kinds.has(preferenceKindFor(row));
    });
    if (cadence === "weekly") {
      const lines = await weeklySummaryLines(ctx, societyId, user, prefs, unread, nowMs);
      if (lines.length && user.email) {
        plan.push({ userId: user._id, displayName: String(user.displayName ?? ""), email: user.email, emailLines: lines, emailCount: lines.length });
      }
      continue;
    }
    const emailItems = visible.filter((row) => prefAllows(prefs, "email", preferenceKindFor(row)));
    const smsItems = visible.filter((row) => prefAllows(prefs, "sms", preferenceKindFor(row)));
    const smsOptedIn = prefs.some((pref) => pref.channel === "sms" && pref.enabled);
    const recipient: DigestRecipient = {
      userId: user._id,
      displayName: String(user.displayName ?? ""),
      email: emailItems.length && user.email ? user.email : undefined,
      phone: smsOptedIn && smsItems.length && user.phone ? user.phone : undefined,
      emailLines: emailItems.slice(0, 10).map((row) => `• [${String(row.severity ?? "info").toUpperCase()}] ${row.title}`),
      emailCount: emailItems.length,
      smsSummary: smsItems.length
        ? `${plural(smsItems.length, "open item")}. ${smsItems.slice(0, 3).map((row) => row.title).join("; ")}`
        : undefined,
    };
    if (recipient.email || recipient.phone) plan.push(recipient);
  }
  return plan;
}

/**
 * Everything the notification settings page needs for the signed-in person:
 * the kinds they can receive, their switches, the workspace thresholds (with
 * whether they may edit each and what it matches right now), bank accounts
 * for the low-balance picker, and a preview of their weekly summary.
 */
export async function notificationSettings(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const viewer = await requireSocietyMembership(ctx, societyId);
  const role = String(viewer.role ?? "");
  const can = (permission: Permission) => hasPermission(role, permission);
  const nowMs = Date.now();
  const prefs = await prefsFor(ctx, viewer._id);
  const kinds = NOTIFICATION_KINDS.filter((kind) => can(kind.permission)).map((kind) => kind.id);
  const { preview, rules } = await collectAlerts(ctx, societyId, nowMs);
  const visibleRules = NOTIFICATION_RULES.filter((def) => kinds.includes(def.kind)).map((def) => {
    const resolved: ResolvedNotificationRule = rules[def.id];
    return { ...resolved, canEdit: can(def.writePermission), preview: preview[def.id] };
  });
  const accounts = can("financials:read")
    ? (await ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect())
      .filter((account: Record<string, any>) => account.accountType === "Bank")
      .map((account: Record<string, any>) => ({
        _id: account._id,
        name: String(account.name),
        currency: String(account.currency ?? "CAD"),
        balanceCents: Number(account.balanceCents) || 0,
        isRestricted: account.isRestricted === true,
      }))
    : [];
  const unread = await unreadForDigest(ctx, societyId, viewer._id, nowMs);
  const weeklyPreview = await weeklySummaryLines(ctx, societyId, viewer as DigestUser, prefs, unread, nowMs);
  const synthetic = isSyntheticOwner(viewer._id);
  return {
    userId: synthetic ? null : viewer._id,
    canSave: !synthetic,
    hasEmail: Boolean((viewer as DigestUser).email),
    hasPhone: Boolean((viewer as DigestUser).phone),
    kinds,
    prefs,
    rules: visibleRules,
    accounts,
    digests: { daily: digestEnabled(prefs, "daily"), weekly: digestEnabled(prefs, "weekly") },
    weeklyPreview,
  };
}
