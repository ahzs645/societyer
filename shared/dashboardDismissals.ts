/**
 * Dismissing and acknowledging dashboard findings (pure, dependency-free).
 *
 * Whether a finding may be dismissed is decided by its requirement basis, not
 * its level (shared/dashboardFindingPolicy.ts): only a recommendation at
 * "warn" or "info" can be dismissed. Statutory, bylaw and internal-policy
 * findings can be acknowledged instead, which records who saw it and leaves it
 * on the dashboard and in every count.
 *
 * Both are stored on the item's `complianceRemediations` row (keyed by society
 * and rule/check id) with the item's subject key at the time
 * (`findingSubjectKey`): the rule version plus what the finding is about, such
 * as the affected directors. A dismissal hides the item only while the item
 * keeps that level and subject, so an item that escalates, or that now
 * concerns another director, record or period, shows again. A row dismissed
 * before subject keys were stored no longer hides anything; it is kept as it
 * was.
 *
 * A requirement can also be snoozed ("Remind me later"): it stays listed and
 * in every count, sorts after the unsnoozed items and is left out of
 * nudges, until the snooze date, a new subject, or a more serious level.
 */

export type DashboardItemLevel = "ok" | "info" | "warn" | "err";
export type RecommendationLevel = "warn" | "info";

/** `complianceRemediations.status` while a dashboard item is dismissed. */
export const DISMISSED_STATUS = "dismissed";

/** `complianceRemediations.status` for a row an acknowledgement created. */
export const ACKNOWLEDGED_STATUS = "acknowledged";

/** `complianceRemediations.status` for a row a snooze ("Remind me later") created. */
export const SNOOZED_STATUS = "snoozed";

/** Statuses that only record attention (an acknowledgement or a snooze), not a workflow. */
export const ATTENTION_ONLY_STATUSES: ReadonlySet<string> = new Set([ACKNOWLEDGED_STATUS, SNOOZED_STATUS]);

/** The furthest ahead a reminder can be snoozed. */
export const SNOOZE_MAX_DAYS = 366;

/** The longest dismissal reason kept. */
export const DISMISSAL_REASON_MAX_LENGTH = 500;

/** The longest acknowledgement note kept. */
export const ACKNOWLEDGEMENT_NOTE_MAX_LENGTH = 500;

/** Who dismissed an item, when, why, and at which level. */
export type DashboardItemDismissal = {
  level: RecommendationLevel;
  dismissedAtISO: string;
  dismissedByName?: string;
  reason?: string;
};

/** Who acknowledged an outstanding requirement, when, and any note. */
export type DashboardItemAcknowledgement = {
  acknowledgedAtISO: string;
  acknowledgedByName?: string;
  note?: string;
};

/**
 * A snoozed requirement: its reminders pause until `untilISO` (a calendar
 * day, YYYY-MM-DD). It stays listed and in every count.
 */
export type DashboardItemSnooze = {
  untilISO: string;
  snoozedByName?: string;
};

/** The `complianceRemediations` fields a dismissal or acknowledgement reads. */
export type DismissalRecord = {
  snoozedUntilISO?: string;
  snoozedByName?: string;
  snoozedSubjectKey?: string;
  snoozedLevel?: string;
  status?: string;
  flagLevel?: string;
  dismissedAtISO?: string;
  dismissedByName?: string;
  dismissalReason?: string;
  dismissedSubjectKey?: string;
  acknowledgedAtISO?: string;
  acknowledgedByName?: string;
  acknowledgementNote?: string;
  acknowledgedSubjectKey?: string;
};

export function isRecommendationLevel(level: unknown): level is RecommendationLevel {
  return level === "warn" || level === "info";
}

/**
 * Binding duties a continuity expectation can rest on. Continuity rule packs
 * mark each expectation `statutory`, `bylaw` or `practice`; only `practice`
 * (or no expectation at all) is a recommendation.
 */
export function isBindingSeverity(severity: unknown): boolean {
  return severity === "statutory" || severity === "bylaw";
}

/**
 * The dismissal that hides an item now, or undefined. A row dismissed at
 * another level or for another subject (the item escalated, or now concerns
 * other records) no longer hides it, and nothing hides a protected item.
 */
export function activeDismissal(
  record: DismissalRecord | null | undefined,
  item: { level: string; dismissable?: boolean; subjectKey?: string },
): DashboardItemDismissal | undefined {
  if (!record || record.status !== DISMISSED_STATUS || !item.dismissable) return undefined;
  if (!isRecommendationLevel(item.level) || record.flagLevel !== item.level) return undefined;
  if (!item.subjectKey || record.dismissedSubjectKey !== item.subjectKey) return undefined;
  return {
    level: item.level,
    dismissedAtISO: record.dismissedAtISO ?? "",
    ...(record.dismissedByName ? { dismissedByName: record.dismissedByName } : {}),
    ...(record.dismissalReason ? { reason: record.dismissalReason } : {}),
  };
}

/** The acknowledgement that applies to the item's current subject, or undefined. */
export function activeAcknowledgement(
  record: DismissalRecord | null | undefined,
  item: { subjectKey?: string },
): DashboardItemAcknowledgement | undefined {
  if (!record?.acknowledgedAtISO || !item.subjectKey || record.acknowledgedSubjectKey !== item.subjectKey) return undefined;
  return {
    acknowledgedAtISO: record.acknowledgedAtISO,
    ...(record.acknowledgedByName ? { acknowledgedByName: record.acknowledgedByName } : {}),
    ...(record.acknowledgementNote ? { note: record.acknowledgementNote } : {}),
  };
}

const LEVEL_RANK: Record<string, number> = { ok: 0, info: 1, warn: 2, err: 3 };

/**
 * The snooze that applies now, or undefined. A snooze ends on its date
 * (`todayISO` is the calendar day, YYYY-MM-DD), when the finding's subject
 * changes, or when the finding becomes more serious than it was when snoozed.
 */
export function activeSnooze(
  record: DismissalRecord | null | undefined,
  item: { level: string; subjectKey?: string },
  todayISO: string,
): DashboardItemSnooze | undefined {
  const until = record?.snoozedUntilISO?.slice(0, 10);
  if (!until || !item.subjectKey || record?.snoozedSubjectKey !== item.subjectKey) return undefined;
  if (!(until > todayISO.slice(0, 10))) return undefined;
  if ((LEVEL_RANK[item.level] ?? 3) > (LEVEL_RANK[record.snoozedLevel ?? ""] ?? 0)) return undefined;
  return { untilISO: until, ...(record.snoozedByName ? { snoozedByName: record.snoozedByName } : {}) };
}

/**
 * The findings that may nudge people (reminders, assistant attention lists):
 * neither dismissed nor snoozed. Counts and the dashboard lists still include
 * snoozed findings.
 */
export function nudgeableFindings<T extends { dismissal?: unknown; snooze?: unknown }>(items: readonly T[]): T[] {
  return items.filter((item) => !item.dismissal && !item.snooze);
}

/** Snoozed findings after the others, each group keeping its order. */
export function snoozedLast<T extends { snooze?: unknown }>(items: readonly T[]): T[] {
  return [...items.filter((item) => !item.snooze), ...items.filter((item) => item.snooze)];
}

/**
 * A snooze end date the server accepts: a real calendar day after today and
 * at most SNOOZE_MAX_DAYS ahead. Returns it as YYYY-MM-DD.
 */
export function normalizeSnoozeUntil(value: unknown, todayISO: string): string {
  const text = typeof value === "string" ? value.trim().slice(0, 10) : "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== text) throw new Error("Choose a date to be reminded on.");
  const today = Date.parse(`${todayISO.slice(0, 10)}T00:00:00Z`);
  if (parsed <= today) throw new Error("Choose a date after today.");
  if (parsed > today + SNOOZE_MAX_DAYS * 86_400_000) throw new Error("Choose a date within a year.");
  return text;
}

/** Trimmed, length-capped reason, or undefined when blank. */
export function normalizeDismissalReason(reason: unknown): string | undefined {
  const text = typeof reason === "string" ? reason.trim() : "";
  return text ? text.slice(0, DISMISSAL_REASON_MAX_LENGTH) : undefined;
}

/** Trimmed, length-capped note, or undefined when blank. */
export function normalizeAcknowledgementNote(note: unknown): string | undefined {
  const text = typeof note === "string" ? note.trim() : "";
  return text ? text.slice(0, ACKNOWLEDGEMENT_NOTE_MAX_LENGTH) : undefined;
}
