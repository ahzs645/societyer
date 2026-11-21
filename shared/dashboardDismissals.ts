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
 */

export type DashboardItemLevel = "ok" | "info" | "warn" | "err";
export type RecommendationLevel = "warn" | "info";

/** `complianceRemediations.status` while a dashboard item is dismissed. */
export const DISMISSED_STATUS = "dismissed";

/** `complianceRemediations.status` for a row an acknowledgement created. */
export const ACKNOWLEDGED_STATUS = "acknowledged";

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

/** The `complianceRemediations` fields a dismissal or acknowledgement reads. */
export type DismissalRecord = {
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
