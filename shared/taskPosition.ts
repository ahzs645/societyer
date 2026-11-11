/**
 * Manual order of tasks within a board column.
 *
 * Each task may carry a `position` number. Positioned tasks sort first, by
 * position; tasks without one keep the order they arrive in after them. A
 * move takes the midpoint of its new neighbours, so one drag writes one task.
 * When two neighbours get too close to split, the positioned part of the
 * column is spaced out again (a rebalance), which writes several tasks.
 */

/** Gap between neighbours after a rebalance, and the step past either end. */
export const TASK_POSITION_STEP = 1024;
/** Neighbours closer than this are spaced out again instead of split. */
export const TASK_POSITION_MIN_GAP = 1e-6;

export type TaskPositionItem = { id: string; position?: number | null };
export type TaskPositionWrite = { id: string; position: number };

export function hasPosition(item: { position?: number | null }): item is { position: number } {
  return typeof item.position === "number" && Number.isFinite(item.position);
}

/** Positioned items first (ascending), then the rest in their incoming order. Stable. */
export function sortByPosition<T extends { position?: number | null }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ap = hasPosition(a.item), bp = hasPosition(b.item);
      if (ap && bp) return (a.item.position as number) - (b.item.position as number) || a.index - b.index;
      if (ap !== bp) return ap ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/** True when a midpoint between these two would not sit strictly between them. */
export function positionsTooClose(before: number, after: number): boolean {
  if (!(after > before)) return true;
  if (after - before < TASK_POSITION_MIN_GAP) return true;
  const middle = before + (after - before) / 2;
  return !(middle > before && middle < after);
}

/**
 * A position between two neighbours: the midpoint when both exist, one step
 * past the only neighbour at either end, and the first step for an empty column.
 * Returns null when the neighbours are too close (rebalance instead).
 */
export function positionBetween(before?: number | null, after?: number | null): number | null {
  const hasBefore = typeof before === "number" && Number.isFinite(before);
  const hasAfter = typeof after === "number" && Number.isFinite(after);
  if (hasBefore && hasAfter) return positionsTooClose(before, after) ? null : before + (after - before) / 2;
  if (hasBefore) return before + TASK_POSITION_STEP;
  if (hasAfter) return after - TASK_POSITION_STEP;
  return TASK_POSITION_STEP;
}

/** Evenly spaced positions for ids in order: STEP, 2·STEP, … */
export function rebalancePositions(ids: readonly string[]): TaskPositionWrite[] {
  return ids.map((id, index) => ({ id, position: (index + 1) * TASK_POSITION_STEP }));
}

/**
 * The writes that put `movingId` at `targetIndex` of `column`.
 *
 * `column` is the column as shown (see `sortByPosition`), and may or may not
 * already contain the moving task (a move from another column does not).
 * `targetIndex` counts places in the column without the moving task, from 0
 * (top) to its length (bottom).
 *
 * - Usually one write: the moving task at the midpoint of its new neighbours.
 * - Dropped below tasks that have no position yet: those tasks, down to the
 *   drop point, get positions too, so the order shown is the order kept.
 * - Neighbours too close to split: the positioned part of the column is
 *   spaced out again; only tasks whose position changes are written.
 * - Dropped where it already is: no writes.
 */
export function planTaskMove(column: readonly TaskPositionItem[], movingId: string, targetIndex: number): TaskPositionWrite[] {
  const currentIndex = column.findIndex((item) => item.id === movingId);
  const rest = column.filter((item) => item.id !== movingId);
  const index = Math.max(0, Math.min(rest.length, Math.floor(Number.isFinite(targetIndex) ? targetIndex : rest.length)));
  if (currentIndex !== -1 && currentIndex === index) return [];
  // Positioned tasks form a prefix of a sorted column.
  let prefix = 0;
  while (prefix < rest.length && hasPosition(rest[prefix])) prefix++;

  if (index > prefix) {
    // Give the unpositioned tasks above the drop point positions, then the moving task.
    let last = prefix > 0 ? (rest[prefix - 1].position as number) : 0;
    const writes: TaskPositionWrite[] = [];
    for (const item of [...rest.slice(prefix, index), { id: movingId }]) {
      last += TASK_POSITION_STEP;
      writes.push({ id: item.id, position: last });
    }
    return writes;
  }

  const before = index > 0 ? rest[index - 1].position : undefined;
  const after = index < prefix ? rest[index].position : undefined;
  const position = positionBetween(before, after);
  if (position !== null) return [{ id: movingId, position }];

  // Too close to split: re-space the positioned part with the moving task in place.
  const order = rest.slice(0, prefix).map((item) => item.id);
  order.splice(index, 0, movingId);
  const previous = new Map(column.map((item) => [item.id, item.position]));
  return rebalancePositions(order).filter((write) => write.id === movingId || previous.get(write.id) !== write.position);
}

/** The new list order after applying writes (for optimistic display and tests). */
export function applyTaskPositionWrites<T extends TaskPositionItem>(items: readonly T[], writes: readonly TaskPositionWrite[]): T[] {
  const byId = new Map(writes.map((write) => [write.id, write.position]));
  return sortByPosition(items.map((item) => (byId.has(item.id) ? { ...item, position: byId.get(item.id) } : item)));
}

/** Server check: a position is a finite number of sane size. */
export function assertTaskPosition(position: unknown): asserts position is number {
  if (typeof position !== "number" || !Number.isFinite(position) || Math.abs(position) > 1e15) {
    throw new Error("A task's board position must be a finite number.");
  }
}
