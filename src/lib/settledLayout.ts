/**
 * Guards for layouts that choose a form from what they measure (a row of
 * tabs or a menu, labelled or icon buttons, a wide or stacked page). Such a
 * choice changes the layout it was measured from, and when the measurement
 * comes out a little differently in each form, the page can flip between the
 * two on every frame: a visible flicker that never settles.
 *
 * Two rules keep these choices settled:
 *
 * - `createFitLatch`: a choice may always become more compact, but becomes
 *   roomier again only once the room it has has actually grown since it
 *   last had to shrink. An estimate that is wrong in one form can then cost a
 *   slightly more compact layout, never a loop.
 * - `settledBand`: a choice made from a width keeps its level until the width
 *   is clearly past a breakpoint, so a scrollbar appearing or disappearing at
 *   the edge (about 15px) can't push it back across.
 */

/**
 * A latch over `levels`, listed from the roomiest form to the most compact.
 * `decide(wanted, room)` returns the form to show: `room` is the space the
 * choice has, measured the same way whichever form is showing (an outer
 * width, less any part whose width doesn't depend on the form).
 */
export function createFitLatch<T extends string>(levels: readonly T[], slack = 2) {
  let current: T | null = null;
  /** The room when the choice last had to become more compact. */
  let shrunkAt = -Infinity;
  return {
    decide(wanted: T, room: number): T {
      if (current === null) {
        current = wanted;
        return wanted;
      }
      const from = levels.indexOf(current);
      const to = levels.indexOf(wanted);
      if (to > from) {
        // More compact: always allowed, and remembered.
        shrunkAt = room;
        current = wanted;
      } else if (to < from && room > shrunkAt + slack) {
        // Roomier only once there is more room than when it last shrank.
        current = wanted;
      }
      return current;
    },
    /** Forget the history (a different list, say), so the next answer is taken as it comes. */
    reset() {
      current = null;
      shrunkAt = -Infinity;
    },
  };
}

/**
 * The level for `value` among `levels` (each with the smallest value it
 * starts at, listed from the largest start down to 0), staying on `current`
 * while `value` is within `band` of the breakpoint it would cross.
 */
export function settledBand<T extends string>(value: number, current: T | null, levels: readonly { id: T; min: number }[], band = 24): T {
  const raw = levels.find((level) => value >= level.min)?.id ?? levels[levels.length - 1].id;
  if (current === null || raw === current) return raw;
  const index = levels.findIndex((level) => level.id === current);
  if (index < 0) return raw;
  const lower = levels[index].min;
  const upper = index > 0 ? levels[index - 1].min : Infinity;
  // Still within reach of the current level's own range: keep it.
  return value >= lower - band && value < upper + band ? current : raw;
}
