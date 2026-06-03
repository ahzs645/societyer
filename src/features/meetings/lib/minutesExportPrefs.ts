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
