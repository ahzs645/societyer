import { MINUTES_EXPORT_STYLES, type MinutesExportStyleId } from "./minutesExportStyles";

export const MINUTES_EXPORT_PREF_PREFIX = "societyer.minutesExport.";

export function readStoredMinutesStyle(): MinutesExportStyleId {
  if (typeof window === "undefined") return "numbered-agenda";
  const stored = window.localStorage.getItem(`${MINUTES_EXPORT_PREF_PREFIX}style`);
  return MINUTES_EXPORT_STYLES.some((style) => style.id === stored)
    ? stored as MinutesExportStyleId
    : "numbered-agenda";
}

export function readStoredExportBool(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(`${MINUTES_EXPORT_PREF_PREFIX}${key}`);
  if (stored == null) return fallback;
  return stored === "true";
}

/**
 * Imported minutes export as the complete source record while they are
 * unreviewed. Once a reviewer has checked them against the source or they
 * have been approved, the corrected minutes are the record and export by
 * default; the source record stays one checkbox away. An explicit choice made
 * on this meeting wins.
 */
export function minutesCorrectedForExport(minutes: any, meeting?: any): boolean {
  return !!minutes?.approvedAt || minutes?.sourceReviewStatus === "source_reviewed" || meeting?.sourceReviewStatus === "source_reviewed";
}

export function effectiveSourceFidelity(stored: boolean, choice: boolean | undefined, minutes: any, meeting?: any): boolean {
  if (choice !== undefined) return choice;
  return minutesCorrectedForExport(minutes, meeting) ? false : stored;
}
