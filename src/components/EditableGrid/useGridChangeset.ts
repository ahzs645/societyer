import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridColumn, GridHistory, GridRow } from "./types";
import { isBlankRow, valuesEqual } from "./values";

const HISTORY_LIMIT = 200;

type Entry<R> = { rows: R[]; label: string };
type State<R> = { base: R[]; present: R[]; past: Entry<R>[]; future: Entry<R>[] };

export type GridChanges<R> = {
  added: R[];
  updated: R[];
  removed: R[];
  /** Added + updated + removed rows (blank added rows are ignored). */
  count: number;
};

export type GridChangeset<R extends GridRow> = {
  rows: R[];
  base: R[];
  apply: (next: R[], label: string) => void;
  history: GridHistory;
  changes: GridChanges<R>;
  dirty: boolean;
  /** Back to the saved rows, as one undoable step. */
  discard: () => void;
  /** Replace the saved rows (after loading or saving) and clear history. */
  rebase: (rows: R[]) => void;
};

function rowChanged<R extends GridRow>(a: R, b: R, columns: GridColumn<R>[]) {
  return columns.some((col) => col.type !== "computed" && !valuesEqual(a[col.key], b[col.key]));
}

export function diffRows<R extends GridRow>(base: R[], present: R[], columns: GridColumn<R>[]): GridChanges<R> {
  const baseByKey = new Map(base.map((row) => [row.key, row]));
  const presentKeys = new Set(present.map((row) => row.key));
  const added: R[] = [];
  const updated: R[] = [];
  for (const row of present) {
    const before = baseByKey.get(row.key);
    if (!before) {
      if (!isBlankRow(row, columns)) added.push(row);
    } else if (rowChanged(before, row, columns)) updated.push(row);
  }
  const removed = base.filter((row) => !presentKeys.has(row.key) && !isBlankRow(row, columns));
  return { added, updated, removed, count: added.length + updated.length + removed.length };
}

/**
 * Local changeset for an editable grid: edits stay pending against the saved
 * rows, with an undo/redo stack, until the host saves or discards them.
 */
export function useGridChangeset<R extends GridRow>(initial: R[], columns: GridColumn<R>[]): GridChangeset<R> {
  const [state, setState] = useState<State<R>>(() => ({ base: initial, present: initial, past: [], future: [] }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback((next: R[], label: string) => {
    const s = stateRef.current;
    if (next === s.present) return;
    const updated = {
      ...s,
      present: next,
      past: [...s.past, { rows: s.present, label }].slice(-HISTORY_LIMIT),
      future: [],
    };
    stateRef.current = updated;
    setState(updated);
  }, []);

  const undo = useCallback(() => {
    const s = stateRef.current;
    const entry = s.past[s.past.length - 1];
    if (!entry) return null;
    const next = { ...s, present: entry.rows, past: s.past.slice(0, -1), future: [{ rows: s.present, label: entry.label }, ...s.future] };
    stateRef.current = next;
    setState(next);
    return entry.label;
  }, []);

  const redo = useCallback(() => {
    const s = stateRef.current;
    const entry = s.future[0];
    if (!entry) return null;
    const next = { ...s, present: entry.rows, future: s.future.slice(1), past: [...s.past, { rows: s.present, label: entry.label }] };
    stateRef.current = next;
    setState(next);
    return entry.label;
  }, []);

  const discard = useCallback(() => {
    const s = stateRef.current;
    apply(s.base, "Discard changes");
  }, [apply]);

  const rebase = useCallback((rows: R[]) => {
    const next = { base: rows, present: rows, past: [], future: [] };
    stateRef.current = next;
    setState(next);
  }, []);

  const changes = useMemo(() => diffRows(state.base, state.present, columns), [state.base, state.present, columns]);

  return {
    rows: state.present,
    base: state.base,
    apply,
    history: { undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 },
    changes,
    dirty: changes.count > 0,
    discard,
    rebase,
  };
}

/** Ask before the tab closes or reloads while edits are pending. */
export function useBeforeUnloadGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

let keyCounter = 0;
/** Client key for rows that do not exist on the server yet. */
export function newRowKey(prefix = "new") {
  keyCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${keyCounter}`;
}
