import { pluralize } from "../../../lib/format";

/**
 * "2 transactions are dated on or before the books close date and were left
 * as they are." for the `skippedLocked` count bulk edits, tag changes, rule
 * runs and Undo return; undefined when nothing was skipped.
 */
export function booksLockedNote(skippedLocked: number | undefined): string | undefined {
  if (!skippedLocked) return undefined;
  return `${pluralize(skippedLocked, "transaction")} ${skippedLocked === 1 ? "is" : "are"} posted on or before the books close date and ${skippedLocked === 1 ? "was" : "were"} left as ${skippedLocked === 1 ? "it is" : "they are"}.`;
}

/** Notes joined into one toast description (undefined when there are none). */
export function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const present = notes.filter((note): note is string => Boolean(note));
  return present.length ? present.join(" ") : undefined;
}

/** "Restored 3 transactions" plus the close-date note for an Undo result. */
export function restoredMessage(undone: { restored?: number; skippedLocked?: number } | null | undefined): [string, string | undefined] {
  return [`Restored ${pluralize(undone?.restored ?? 0, "transaction")}`, booksLockedNote(undone?.skippedLocked)];
}
