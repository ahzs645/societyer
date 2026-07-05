/**
 * The single read accessor for a minutes document's motions.
 *
 * Part of finishing the motions migration (docs/motions-migration-finish-scope.md):
 * every read-only consumer of a minutes' motions goes through here so the later
 * "flip reads off the embedded array" is a change to this one function, not to
 * every call site.
 *
 * Rule: an APPROVED minutes renders from its frozen `motionSnapshots[]` (an
 * immutable legal record), a draft renders its live `motions[]`. Snapshots are
 * frozen from `motions[]` at approval time, so today this is a no-op for
 * well-behaved data — but it is the correct behaviour once live motions come
 * from the mutable `motions` table.
 *
 * Pure module (no imports) so both the frontend renderer and the Convex export
 * paths can use it. NOT for the editor, which mutates the live `motions[]`.
 */
export function minutesMotionsForDisplay<M>(
  minutes: { motions?: M[] | null; motionSnapshots?: M[] | null } | null | undefined,
): M[] {
  if (!minutes) return [];
  if (minutes.motionSnapshots && minutes.motionSnapshots.length > 0) {
    return minutes.motionSnapshots;
  }
  return minutes.motions ?? [];
}

/**
 * Reconstruct a minutes' embedded `outcome` string from a first-class `motions`
 * row's explicit (status, outcome) split — the inverse of
 * `statusFromEmbeddedOutcome` (shared/functions/minutes.ts). Used by the
 * table→embedded adapter so display code that keys off `outcome`
 * (normalizeMotionOutcome, isPostponedOutcome, "carried/defeated/tabled" counts)
 * behaves identically whether it reads the embedded array or the table.
 */
export function embeddedOutcomeFromMotionRow(
  row: { status?: string | null; outcome?: string | null } | null | undefined,
): string {
  if (!row) return "";
  const status = String(row.status ?? "").trim();
  const outcome = row.outcome ? String(row.outcome) : "";
  switch (status) {
    case "Voted":
      return outcome || "Carried"; // Voted always carries a recorded outcome
    case "Tabled":
      return "Tabled";
    case "Deferred":
      return "Deferred";
    case "Withdrawn":
      return "Withdrawn";
    case "Moved":
    case "Draft":
    case "Agenda":
    case "Backlog":
    case "":
      return "Pending";
    default:
      // Archived / unknown lifecycle states — prefer the explicit outcome.
      return outcome || "Pending";
  }
}

/**
 * Map a first-class `motions` table row back to the embedded motion shape that
 * minutes rendering/export/analytics expect. The inverse of the dual-write
 * (syncMotionsForMinutes): `title`→`name`, `resolutionTypeLabel`→`resolutionType`,
 * (status, outcome)→`outcome`, and the table row `_id` surfaced as `motionId`.
 * Enriched fields the embedded array never carried (decidedBy, proceduralKind)
 * pass through additively. Undefined keys are dropped to match the embedded
 * array's optional-field shape. Pure — the seam Phase 2 reads flip onto.
 */
export function motionRowToEmbedded(row: any): any {
  if (!row) return row;
  const out: Record<string, any> = {
    name: row.title,
    text: row.text ?? "",
    movedBy: row.movedBy,
    movedByMemberId: row.movedByMemberId,
    movedByDirectorId: row.movedByDirectorId,
    secondedBy: row.secondedBy,
    secondedByMemberId: row.secondedByMemberId,
    secondedByDirectorId: row.secondedByDirectorId,
    outcome: embeddedOutcomeFromMotionRow(row),
    votesFor: row.votesFor,
    votesAgainst: row.votesAgainst,
    abstentions: row.abstentions,
    resolutionType: row.resolutionTypeLabel,
    decidedBy: row.decidedBy,
    sectionIndex: row.sectionIndex,
    sectionTitle: row.sectionTitle,
    motionTemplateId: row.motionTemplateId,
    motionId: row._id,
    adoptsMinutesId: row.adoptsMinutesId,
  };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out;
}
