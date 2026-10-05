import { HISTORY_KINDS, SECTION_RECORD_KINDS } from "./functions/importSessionHelpers/importSessionConstants";

/** A record completes only through a destination that actually accepts its kind. */
export function approvedImportRecordNeedsApply(record: any): boolean {
  if (record.status !== "Approved") return false;
  const targets = record.importedTargets ?? {};
  if (record.recordKind === "documentCandidate") return !targets.documents;
  if (record.recordKind === "meetingMinutes") return !targets.meetings;
  if (record.recordKind === "source") return !targets.orgHistory;
  if (record.recordKind === "motion") return !(targets.meetings || targets.orgHistory);
  if ((HISTORY_KINDS as readonly string[]).includes(record.recordKind)) return !targets.orgHistory;
  if ((SECTION_RECORD_KINDS as readonly string[]).includes(record.recordKind)) return !targets.sections;
  return true;
}

export function isActiveImportSession(session: any): boolean {
  const summary = session?.summary ?? {};
  if (Number(summary.byStatus?.Pending ?? 0) > 0) return true;
  if (Number.isFinite(summary.approvedUnapplied)) return summary.approvedUnapplied > 0;
  // Legacy summaries cannot prove completion by adding target counts: one row
  // can have multiple targets. The query recomputes them; stay visible meanwhile.
  return Number(summary.byStatus?.Approved ?? 0) > 0;
}
