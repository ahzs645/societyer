/**
 * Notification catalogue: the kinds a person can be told about, the channels
 * that can reach them, and the workspace alert thresholds.
 *
 * Shared by the server (list filtering, alert generation, digests) and the
 * settings UI so both agree on what a kind means, who may receive it and what
 * each channel does by default.
 */
import type { Permission } from "./functions/permissions";
import { attentionReasons } from "./transactionAttention";

export type NotificationChannel = "inApp" | "email" | "sms";

export const NOTIFICATION_CHANNELS: ReadonlyArray<{ id: NotificationChannel; label: string; description: string }> = [
  { id: "inApp", label: "In app", description: "The bell and the Notifications inbox." },
  { id: "email", label: "Email", description: "Included in your daily digest email." },
  { id: "sms", label: "Text", description: "Included in the daily text summary. Needs a phone number on your profile." },
];

export type NotificationGroupId = "deadlines" | "meetings" | "tasks" | "finance" | "documents" | "people" | "system";

export const NOTIFICATION_GROUPS: ReadonlyArray<{ id: NotificationGroupId; label: string; corporationLabel?: string }> = [
  { id: "deadlines", label: "Deadlines and filings" },
  { id: "meetings", label: "Meetings" },
  { id: "tasks", label: "Tasks and workflows" },
  { id: "finance", label: "Finance and approvals" },
  { id: "documents", label: "Documents" },
  { id: "people", label: "Members and volunteers", corporationLabel: "People" },
  { id: "system", label: "System" },
];

export type NotificationKindId =
  | "deadline" | "filing" | "commitment" | "grant"
  | "minutes" | "transcript" | "notice"
  | "bot"
  | "budget" | "balance" | "approval" | "finance_sync"
  | "signature" | "retention"
  | "governance" | "billing" | "volunteer"
  | "communication" | "general";

export type NotificationKindDef = {
  id: NotificationKindId;
  group: NotificationGroupId;
  label: string;
  description: string;
  corporationLabel?: string;
  corporationDescription?: string;
  /** The permission a person needs to receive this kind at all. */
  permission: Permission;
  /** Set when one of the workspace thresholds below generates this kind. */
  rule?: NotificationRuleId;
};

export const NOTIFICATION_KINDS: readonly NotificationKindDef[] = [
  { id: "deadline", group: "deadlines", label: "Deadlines", description: "A compliance deadline is coming up or has passed.", permission: "deadlines:read", rule: "deadline_lead" },
  { id: "filing", group: "deadlines", label: "Filings", description: "A government filing is due soon or is overdue.", permission: "filings:read" },
  { id: "commitment", group: "deadlines", label: "Commitments", description: "A contract or other commitment reaches its notice date.", permission: "commitments:read" },
  { id: "grant", group: "deadlines", label: "Grant reports", description: "A report owed to a funder is due soon or is overdue.", permission: "grants:read" },

  { id: "minutes", group: "meetings", label: "Minutes", description: "Draft minutes are ready, or minutes are waiting for signatures.", permission: "minutes:read" },
  { id: "transcript", group: "meetings", label: "Transcripts", description: "A meeting recording has finished transcribing.", permission: "meetings:read" },
  { id: "notice", group: "meetings", label: "Notices sent to you", description: "A meeting notice or message is delivered to you in the app.", permission: "society:read" },

  { id: "bot", group: "tasks", label: "Workflows and assistants", description: "A workflow or the filing assistant starts, needs your input, finishes or fails.", permission: "tasks:read" },

  { id: "budget", group: "finance", label: "Budget alerts", description: "Spending on a budget line passes the threshold set under Alert thresholds.", permission: "financials:read", rule: "budget_line" },
  { id: "balance", group: "finance", label: "Low balance", description: "A bank account balance falls below the amount set under Alert thresholds.", permission: "financials:read", rule: "low_balance" },
  { id: "approval", group: "finance", label: "Claims waiting for approval", description: "An expense claim has waited for approval longer than the time set under Alert thresholds.", permission: "financials:read", rule: "claim_waiting" },
  { id: "finance_sync", group: "finance", label: "Bank and accounting sync", description: "Accounts or transactions finish importing from a connected source.", permission: "financials:read" },

  { id: "signature", group: "documents", label: "Signatures", description: "Someone signs a document, minutes or a resolution.", permission: "documents:read" },
  { id: "retention", group: "documents", label: "Records retention", description: "Records pass their retention period and need a decision.", permission: "documents:read" },

  { id: "governance", group: "people", label: "Director terms and attestations", description: "A director's term is ending, or the annual attestations open.", permission: "directors:read" },
  { id: "billing", group: "people", label: "Member subscriptions", description: "A member subscription starts, is paid, fails or is cancelled.", corporationLabel: "Subscriptions", corporationDescription: "A subscription starts, is paid, fails or is cancelled.", permission: "members:read" },
  { id: "volunteer", group: "people", label: "Volunteer screenings", description: "A volunteer's screening is about to expire or has expired.", permission: "volunteers:read" },

  { id: "communication", group: "system", label: "Sent mailings", description: "A mailing or notice finishes sending, with a count of any bounces.", permission: "communications:read" },
  { id: "general", group: "system", label: "Other updates", description: "Announcements and anything that doesn't fit a category above.", permission: "society:read" },
];

const KIND_BY_ID = new Map<string, NotificationKindDef>(NOTIFICATION_KINDS.map((kind) => [kind.id, kind]));

export function notificationKind(id: string): NotificationKindDef | undefined {
  return KIND_BY_ID.get(id);
}

/** Campaign kinds that the communications module delivers to a person's bell. */
const CAMPAIGN_KINDS = new Set(["notice", "renewal", "digest", "newsletter", "reminder"]);

function appPath(href?: string): string {
  const path = String(href ?? "");
  return path.startsWith("/app/") ? path.slice(4) : path.startsWith("/demo/app/") ? path.slice(9) : path;
}

/**
 * The preference kind a stored notification row belongs to. Older generators
 * filed several kinds of alert under "general"; the link tells them apart so a
 * preference applies to rows written before the kind was split out.
 */
export function preferenceKindFor(row: { kind?: unknown; linkHref?: unknown; title?: unknown } | Record<string, any>): NotificationKindId {
  const kind = String(row.kind ?? "general");
  if (kind !== "general") {
    if (KIND_BY_ID.has(kind)) return kind as NotificationKindId;
    if (CAMPAIGN_KINDS.has(kind)) return "notice";
    return "general";
  }
  const path = appPath(typeof row.linkHref === "string" ? row.linkHref : undefined);
  if (path.startsWith("/grants")) return "grant";
  if (path.startsWith("/volunteers")) return "volunteer";
  if (path.startsWith("/commitments")) return "commitment";
  if (path.startsWith("/financials")) return "finance_sync";
  if (path.startsWith("/retention")) return "retention";
  if (path.startsWith("/attestations")) return "governance";
  if (String(row.title ?? "").startsWith("Communication sent")) return "communication";
  return "general";
}

export type NotificationPrefRow = { channel: string; kind: string; enabled: boolean };

/** Channel defaults: in-app and email on, text messages opt-in only. */
export function channelDefault(channel: string): boolean {
  return channel === "inApp" || channel === "email";
}

/**
 * Does a person's preference let `kind` through `channel`? An exact
 * (channel, kind) row wins, then a (channel, "all") row, then the default.
 */
export function prefAllows(prefs: readonly NotificationPrefRow[], channel: string, kind: string): boolean {
  const exact = prefs.find((pref) => pref.channel === channel && pref.kind === kind);
  if (exact) return exact.enabled;
  const wildcard = prefs.find((pref) => pref.channel === channel && pref.kind === "all");
  if (wildcard) return wildcard.enabled;
  return channelDefault(channel);
}

/** Digest subscriptions are stored as email preferences with these kinds. */
export const DIGEST_KINDS = { daily: "digest:daily", weekly: "digest:weekly" } as const;
export type DigestCadence = keyof typeof DIGEST_KINDS;

export function digestEnabled(prefs: readonly NotificationPrefRow[], cadence: DigestCadence): boolean {
  const row = prefs.find((pref) => pref.channel === "email" && pref.kind === DIGEST_KINDS[cadence]);
  if (row) return row.enabled;
  // The daily digest predates this setting and stays on; the weekly summary is opt-in.
  return cadence === "daily";
}

export function isPreferenceKind(kind: string): boolean {
  return kind === "all" || KIND_BY_ID.has(kind) || kind === DIGEST_KINDS.daily || kind === DIGEST_KINDS.weekly;
}

export function isNotificationChannel(channel: string): channel is NotificationChannel {
  return channel === "inApp" || channel === "email" || channel === "sms";
}

// ---------------------------------------------------------------------------
// Workspace alert thresholds
// ---------------------------------------------------------------------------

export type NotificationRuleId = "budget_line" | "low_balance" | "deadline_lead" | "claim_waiting";

export type NotificationRuleDef = {
  id: NotificationRuleId;
  kind: NotificationKindId;
  /** Unit of `value`: a percentage, an amount in cents or a number of days. */
  unit: "percent" | "cents" | "days";
  min: number;
  max: number;
  defaultEnabled: boolean;
  defaultValue: number;
  /** Who can change this threshold for the workspace. */
  writePermission: Permission;
};

export const NOTIFICATION_RULES: readonly NotificationRuleDef[] = [
  { id: "budget_line", kind: "budget", unit: "percent", min: 1, max: 500, defaultEnabled: true, defaultValue: 90, writePermission: "financials:write" },
  { id: "low_balance", kind: "balance", unit: "cents", min: 0, max: 100_000_000_000, defaultEnabled: false, defaultValue: 500_000, writePermission: "financials:write" },
  { id: "deadline_lead", kind: "deadline", unit: "days", min: 1, max: 180, defaultEnabled: true, defaultValue: 14, writePermission: "deadlines:write" },
  { id: "claim_waiting", kind: "approval", unit: "days", min: 1, max: 90, defaultEnabled: true, defaultValue: 3, writePermission: "financials:write" },
];

const RULE_BY_ID = new Map<string, NotificationRuleDef>(NOTIFICATION_RULES.map((rule) => [rule.id, rule]));

export function notificationRule(id: string): NotificationRuleDef | undefined {
  return RULE_BY_ID.get(id);
}

export type NotificationRuleRow = { rule: string; enabled: boolean; value: number; accountId?: string | null };
export type ResolvedNotificationRule = { rule: NotificationRuleId; enabled: boolean; value: number; accountId?: string; stored: boolean };

/** Every threshold with its stored setting, or its default when none is stored. */
export function resolveNotificationRules(rows: readonly NotificationRuleRow[]): Record<NotificationRuleId, ResolvedNotificationRule> {
  const out = {} as Record<NotificationRuleId, ResolvedNotificationRule>;
  for (const def of NOTIFICATION_RULES) {
    const row = rows.find((candidate) => candidate.rule === def.id);
    out[def.id] = row
      ? { rule: def.id, enabled: row.enabled, value: clampRuleValue(def, row.value), accountId: row.accountId ?? undefined, stored: true }
      : { rule: def.id, enabled: def.defaultEnabled, value: def.defaultValue, stored: false };
  }
  return out;
}

export function clampRuleValue(def: NotificationRuleDef, value: number): number {
  if (!Number.isFinite(value)) return def.defaultValue;
  const rounded = Math.round(value);
  return Math.min(def.max, Math.max(def.min, rounded));
}

/**
 * The digest's view of a transaction that needs attention: no category, or a
 * missing receipt on a payment large enough to need one. Uses the same rules
 * as the transactions table's "Needs attention" view. Internal transfers are
 * skipped by the caller.
 */
export function transactionNeedsAttention(txn: Record<string, any>): { uncategorized: boolean; missingReceipt: boolean } {
  const reasons = attentionReasons({ ...txn, amountCents: Number(txn.amountCents ?? 0) });
  return { uncategorized: reasons.includes("uncategorized"), missingReceipt: reasons.includes("receipt") };
}
