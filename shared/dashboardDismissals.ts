/**
 * Dismissing dashboard recommendations (pure, dependency-free).
 *
 * The dashboard's compliance flags and record-continuity checks carry a level.
 * "warn" and "info" items are recommendations and a workspace may dismiss
 * them; "err" items are legal requirements or failures and stay until they are
 * resolved. A continuity check that rests on a statutory or bylaw expectation
 * is a requirement whatever its level.
 *
 * A dismissal is stored on the item's `complianceRemediations` row (keyed by
 * society and rule/check id) with the level the item had when it was
 * dismissed. It hides the item only while the item still has that level, so
 * an item that escalates (warn -> err) or otherwise changes level shows again.
 */

export type DashboardItemLevel = "ok" | "info" | "warn" | "err";
export type RecommendationLevel = "warn" | "info";

/** `complianceRemediations.status` while a dashboard item is dismissed. */
export const DISMISSED_STATUS = "dismissed";

/** The longest dismissal reason kept. */
export const DISMISSAL_REASON_MAX_LENGTH = 500;

/** Who dismissed an item, when, why, and at which level. */
export type DashboardItemDismissal = {
  level: RecommendationLevel;
  dismissedAtISO: string;
  dismissedByName?: string;
  reason?: string;
};

/** The `complianceRemediations` fields a dismissal reads. */
export type DismissalRecord = {
  status?: string;
  flagLevel?: string;
  dismissedAtISO?: string;
  dismissedByName?: string;
  dismissalReason?: string;
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
 * another level (the item escalated or changed) no longer hides it.
 */
export function activeDismissal(
  record: DismissalRecord | null | undefined,
  item: { level: string; dismissable?: boolean },
): DashboardItemDismissal | undefined {
  if (!record || record.status !== DISMISSED_STATUS || !item.dismissable) return undefined;
  if (!isRecommendationLevel(item.level) || record.flagLevel !== item.level) return undefined;
  return {
    level: item.level,
    dismissedAtISO: record.dismissedAtISO ?? "",
    ...(record.dismissedByName ? { dismissedByName: record.dismissedByName } : {}),
    ...(record.dismissalReason ? { reason: record.dismissalReason } : {}),
  };
}

/** Trimmed, length-capped reason, or undefined when blank. */
export function normalizeDismissalReason(reason: unknown): string | undefined {
  const text = typeof reason === "string" ? reason.trim() : "";
  return text ? text.slice(0, DISMISSAL_REASON_MAX_LENGTH) : undefined;
}
