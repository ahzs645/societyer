/**
 * Conflict-of-interest declarations link to a motion via `motionIndex` — a raw
 * position in `minutes.motions`, which is a positional array that the motion
 * editor freely reorders and deletes. Nothing remaps stored indexes, so the
 * index alone can silently start pointing at a different motion.
 *
 * Declarations therefore also carry `motionText`, a snapshot of the motion's
 * text at declaration time, and this resolver re-derives the link at render
 * time. The contract, in order:
 *
 *  1. If the motion at `motionIndex` still matches the snapshot (or there is
 *     no snapshot — legacy rows), trust the index.
 *  2. Otherwise find the snapshot text among the current motions; a unique
 *     match means the motion simply moved.
 *  3. Otherwise give up and surface the snapshot text as a stale label —
 *     for a legal record, "we can no longer locate this motion" is strictly
 *     better than attributing the recusal to whatever now sits at that index.
 */

export type ConflictMotionResolution =
  | { kind: "resolved"; index: number; motion: any }
  | { kind: "stale"; motionText: string }
  | null;

function normalizeMotionText(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function resolveConflictMotion(
  conflict: { motionIndex?: number | null; motionText?: string | null },
  motions: Array<{ text?: string; name?: string }> | null | undefined,
): ConflictMotionResolution {
  if (conflict?.motionIndex == null) return null;
  const list = motions ?? [];
  const snapshot = normalizeMotionText(conflict.motionText);
  const atIndex = list[conflict.motionIndex];

  if (atIndex) {
    if (!snapshot) return { kind: "resolved", index: conflict.motionIndex, motion: atIndex };
    if (
      normalizeMotionText(atIndex.text) === snapshot ||
      normalizeMotionText(atIndex.name) === snapshot
    ) {
      return { kind: "resolved", index: conflict.motionIndex, motion: atIndex };
    }
  }

  if (snapshot) {
    const matches = list
      .map((motion, index) => ({ motion, index }))
      .filter(
        ({ motion }) =>
          normalizeMotionText(motion.text) === snapshot ||
          normalizeMotionText(motion.name) === snapshot,
      );
    if (matches.length === 1) {
      return { kind: "resolved", index: matches[0].index, motion: matches[0].motion };
    }
    return { kind: "stale", motionText: String(conflict.motionText ?? "") };
  }

  // Legacy row (no snapshot) pointing past the end of the array — the motion
  // it referenced is gone or moved and we cannot tell which.
  return atIndex ? { kind: "resolved", index: conflict.motionIndex, motion: atIndex } : null;
}
