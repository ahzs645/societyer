/**
 * Goal status display helpers, shared by the Goals pages, committee detail
 * and the dashboard so a goal reads the same everywhere ("At risk", not the
 * stored "OnTrack" on one screen and "At risk" on the next).
 */

/**
 * Display-only status override: a goal past its target date and not already
 * Completed/OffTrack reads as "At risk" even if nobody went back and updated
 * the manually-set status field. Doesn't touch the stored value, so board
 * drag-and-drop (grouped by the literal stored status) is unaffected.
 */
export function effectiveGoalStatus(goal: { status?: string; targetDate?: string }) {
  const status = goal.status ?? "NotStarted";
  if (status === "Completed" || status === "OffTrack" || status === "AtRisk") return status;
  if (goal.targetDate && new Date(goal.targetDate).getTime() < Date.now()) return "AtRisk";
  return status;
}

export function goalTone(status: string) {
  return status === "OnTrack" || status === "Completed"
    ? ("success" as const)
    : status === "AtRisk"
      ? ("warn" as const)
      : status === "OffTrack"
        ? ("danger" as const)
        : ("neutral" as const);
}

export function labelStatus(s: string) {
  return s === "NotStarted" ? "Not started"
    : s === "OnTrack" ? "On track"
    : s === "AtRisk" ? "At risk"
    : s === "OffTrack" ? "Off track"
    : s;
}
