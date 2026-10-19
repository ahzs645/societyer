/*
 * Undo/redo stack for RecordTable grid edits, kept per table store for the
 * session. An entry remembers each cell's value before and after, so undo
 * and redo replay it through the same commit path as the edit. Pure.
 */

export type EditChange = { recordId: string; fieldName: string; before: unknown; after: unknown };

export type EditHistoryEntry = { id: number; label: string; changes: EditChange[] };

export type EditHistory = { past: EditHistoryEntry[]; future: EditHistoryEntry[] };

export const EMPTY_EDIT_HISTORY: EditHistory = { past: [], future: [] };

export const EDIT_HISTORY_LIMIT = 100;

let nextEntryId = 0;

export function createEditEntry(label: string, changes: EditChange[]): EditHistoryEntry {
  nextEntryId += 1;
  return { id: nextEntryId, label, changes };
}

/** A new edit: it goes on top and the redo branch is dropped. */
export function recordEdit(history: EditHistory, entry: EditHistoryEntry, limit = EDIT_HISTORY_LIMIT): EditHistory {
  if (entry.changes.length === 0) return history;
  return { past: [...history.past, entry].slice(-limit), future: [] };
}

/** Takes the latest edit off the stack. Apply `before` values to undo it. */
export function undoEdit(history: EditHistory): { history: EditHistory; entry: EditHistoryEntry } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return { entry, history: { past: history.past.slice(0, -1), future: [entry, ...history.future] } };
}

/** Takes the latest undone edit back. Apply `after` values to redo it. */
export function redoEdit(history: EditHistory): { history: EditHistory; entry: EditHistoryEntry } | null {
  const entry = history.future[0];
  if (!entry) return null;
  return { entry, history: { past: [...history.past, entry], future: history.future.slice(1) } };
}

/** Forgets an entry whose save failed, wherever it now sits. */
export function dropEdit(history: EditHistory, id: number): EditHistory {
  const past = history.past.filter((entry) => entry.id !== id);
  const future = history.future.filter((entry) => entry.id !== id);
  return past.length === history.past.length && future.length === history.future.length ? history : { past, future };
}

/**
 * Keeps only the changes of an entry that saved (by index), so undo still
 * covers the cells a partly failed paste did change. Drops it when none did.
 */
export function narrowEdit(history: EditHistory, id: number, saved: readonly boolean[]): EditHistory {
  const narrow = (entry: EditHistoryEntry) => (entry.id === id ? { ...entry, changes: entry.changes.filter((_, index) => saved[index]) } : entry);
  const past = history.past.map(narrow).filter((entry) => entry.changes.length > 0);
  const future = history.future.map(narrow).filter((entry) => entry.changes.length > 0);
  return { past, future };
}

/** The cell writes that undo (`"before"`) or redo (`"after"`) an entry. */
export function entryWrites(entry: EditHistoryEntry, side: "before" | "after") {
  return entry.changes.map((change) => ({ recordId: change.recordId, fieldName: change.fieldName, value: change[side] }));
}
