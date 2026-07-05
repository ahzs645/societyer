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
