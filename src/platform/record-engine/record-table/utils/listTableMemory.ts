import type { HydratedView } from "../../types";
import type { RecordTableState, RecordTableStore } from "../state/recordTableStore";
import { cleanListViewState, type ListViewState } from "../../../../../shared/listViewState";
import { listViewStateFromTable, tableSlicesFromListViewState, type ListViewSlices } from "./listViewState";

/**
 * What a browser remembers of an in-memory list (`RecordListTable`) for one
 * person in one workspace: its last columns, sorts, filters, grouping, display
 * mode and density, and the named view it was on. Kept in localStorage under
 * `listTableMemoryKey`, written a moment after each change; a list back at its
 * default view clears its entry, so a later change to the default in code
 * still reaches it.
 */
type ListTableMemory = {
  v: 1;
  /** `listViewFieldsHash` of the list when this was written. */
  fields: string;
  /** The named view (listViews id) the list was on; null for its default view. */
  viewId: string | null;
  state: ListViewState;
};

export const LIST_TABLE_MEMORY_WRITE_DELAY_MS = 400;

export function listTableMemoryKey(societyId: string, userId: string, tableId: string) {
  return `societyer:list-table:${societyId}:${userId}:${tableId}`;
}

export function readListTableMemory(key: string, fieldsHash: string): { viewId: string | null; state: ListViewState } | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const memory = parsed as Partial<ListTableMemory>;
    if (memory.v !== 1) return null;
    const state = cleanListViewState(memory.state);
    const viewId = typeof memory.viewId === "string" && memory.viewId.length <= 200 ? memory.viewId : null;
    // Written for a different set of fields: keep the layout, not the filters.
    if (memory.fields !== fieldsHash) return { viewId, state: { ...state, filters: [], filterGroups: [] } };
    return { viewId, state };
  } catch {
    return null;
  }
}

function writeListTableMemory(key: string, memory: ListTableMemory | null) {
  try {
    if (memory) window.localStorage.setItem(key, JSON.stringify(memory));
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode, a full quota or blocked storage: the list simply isn't remembered.
  }
}

/** Puts live state over a freshly loaded view; the view stays the saved one. */
export function applyTableSlices(store: Pick<RecordTableStore, "getState" | "setState">, slices: ListViewSlices) {
  const state = store.getState();
  state.setColumns(slices.columns);
  store.setState({
    sorts: slices.sorts,
    filters: slices.filters,
    filterGroups: slices.filterGroups,
    viewGroups: slices.viewGroups,
    density: slices.density,
  });
}

/**
 * Restores a remembered state onto a new store (whose default view has just
 * loaded). Returns the named view it was on, for the views menu to adopt once
 * the workspace's views have loaded.
 */
export function restoreListTableMemory(store: RecordTableStore, key: string, fieldsHash: string, base: HydratedView): string | null {
  const memory = readListTableMemory(key, fieldsHash);
  if (!memory) return null;
  applyTableSlices(store, tableSlicesFromListViewState(base, memory.state));
  return memory.viewId;
}

/**
 * After the list's definition is replaced (the invoice list's per-currency
 * columns, say), keeps what the person had: the live layout, filters and
 * search over the new columns, and the named view they were on.
 */
export function carryListTableState(store: RecordTableStore, previous: RecordTableState, base: HydratedView) {
  let state: ListViewState;
  try {
    state = listViewStateFromTable(previous);
  } catch {
    return;
  }
  applyTableSlices(store, tableSlicesFromListViewState(base, state));
  const onNamedView = !!previous.viewId && previous.viewId !== base.view._id;
  store.setState(onNamedView
    ? { searchTerm: previous.searchTerm, viewId: previous.viewId, savedView: previous.savedView }
    : { searchTerm: previous.searchTerm });
}

const MEMORY_SLICES =["columns", "sorts", "filters", "filterGroups", "viewGroups", "density", "viewId"] as const;

export function memorySlicesChanged(state: RecordTableState, previous: RecordTableState) {
  return MEMORY_SLICES.some((slice) => state[slice] !== previous[slice]);
}

/** Writes the store's current state (or clears it, when it is the default view as defined). */
export function rememberListTable(key: string, fieldsHash: string, state: RecordTableState, base: HydratedView) {
  let current: ListViewState;
  try {
    current = listViewStateFromTable(state);
  } catch {
    return;
  }
  const viewId = state.viewId && state.viewId !== base.view._id ? state.viewId : null;
  if (!viewId) {
    // The default view as the store loaded it (its label column first), else as defined.
    const saved = state.savedView?.viewId === base.view._id ? state.savedView : null;
    let asDefined: ListViewState | null = null;
    try {
      asDefined = listViewStateFromTable(saved ?? {
        columns: base.columns,
        sorts: base.view.sorts,
        filters: base.view.filters,
        filterGroups: base.view.filterGroups,
        viewGroups: base.view.groups,
        density: base.view.density,
      });
    } catch {
      asDefined = null;
    }
    if (asDefined && JSON.stringify(asDefined) === JSON.stringify(current)) {
      writeListTableMemory(key, null);
      return;
    }
  }
  writeListTableMemory(key, { v: 1, fields: fieldsHash, viewId, state: current });
}
