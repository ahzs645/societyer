import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";
import type { HydratedView, RecordField, ViewFilter, ViewSort } from "../../types";

/**
 * Per-table-instance state. Mirrors Twenty's `createAtomComponentState`
 * pattern: every RecordTable on the page has its own independent store
 * (for selection, hover, focus, column widths, etc.), and components
 * inside it pull the store from context.
 */

export type CellPosition = { rowIndex: number; columnIndex: number };

export type RecordTableState = {
  /* identity */
  tableId: string;
  objectMetadataId: string;
  viewId: string | null;

  /* columns — derived from the active view, but mutable for unsaved
     resize / reorder gestures */
  columns: RecordField[];
  setColumns: (columns: RecordField[]) => void;
  resizeColumn: (viewFieldId: string, size: number) => void;
  reorderColumns: (orderedViewFieldIds: string[]) => void;
  toggleColumnVisibility: (viewFieldId: string) => void;

  /* density */
  density: "compact" | "comfortable";
  setDensity: (density: "compact" | "comfortable") => void;

  /* filters + sort + search */
  filters: ViewFilter[];
  setFilters: (filters: ViewFilter[]) => void;
  sorts: ViewSort[];
  setSorts: (sorts: ViewSort[]) => void;
  searchTerm: string;
  setSearchTerm: (searchTerm: string) => void;

  /* selection */
  selectedRecordIds: Set<string>;
  setSelectedRecordIds: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  clearSelection: () => void;

  /* interaction state */
  hoverPosition: CellPosition | null;
  setHoverPosition: (pos: CellPosition | null) => void;
  focusedCell: CellPosition | null;
  setFocusedCell: (pos: CellPosition | null) => void;
  editingCell: CellPosition | null;
  setEditingCell: (pos: CellPosition | null) => void;

  /* loaded records */
  records: any[];
  setRecords: (records: any[]) => void;

  /* hydrate from a freshly loaded view */
  loadView: (hydrated: HydratedView) => void;
};

export type RecordTableStore = ReturnType<typeof createRecordTableStore>;

export function createRecordTableStore(opts: {
  tableId: string;
  objectMetadataId: string;
}) {
  return createStore<RecordTableState>()((set, get) => ({
    tableId: opts.tableId,
    objectMetadataId: opts.objectMetadataId,
    viewId: null,
    columns: [],
    density: "compact",
    filters: [],
    sorts: [],
    searchTerm: "",
    selectedRecordIds: new Set(),
    hoverPosition: null,
    focusedCell: null,
    editingCell: null,
    records: [],

    setColumns: (columns) => set({ columns }),
    resizeColumn: (viewFieldId, size) =>
      set((state) => ({
        columns: state.columns.map((c) =>
          c.viewFieldId === viewFieldId ? { ...c, size } : c,
        ),
      })),
    reorderColumns: (orderedViewFieldIds) =>
      set((state) => {
        const byId = new Map(state.columns.map((c) => [c.viewFieldId, c]));
        const reordered: RecordField[] = [];
        orderedViewFieldIds.forEach((id, i) => {
          const col = byId.get(id);
          if (col) reordered.push({ ...col, position: i });
        });
        // Keep any columns we didn't know about.
        for (const col of state.columns) {
          if (!orderedViewFieldIds.includes(col.viewFieldId)) reordered.push(col);
        }
        return { columns: reordered };
      }),
    toggleColumnVisibility: (viewFieldId) =>
      set((state) => ({
        columns: state.columns.map((c) =>
          c.viewFieldId === viewFieldId ? { ...c, isVisible: !c.isVisible } : c,
        ),
      })),

    setDensity: (density) => set({ density }),
    setFilters: (filters) => set({ filters }),
    setSorts: (sorts) => set({ sorts }),
    setSearchTerm: (searchTerm) => set({ searchTerm }),

    setSelectedRecordIds: (next) =>
      set((state) => {
        const resolved =
          typeof next === "function"
            ? (next as (prev: Set<string>) => Set<string>)(state.selectedRecordIds)
            : next;
        return { selectedRecordIds: resolved };
      }),
    clearSelection: () => set({ selectedRecordIds: new Set() }),

    setHoverPosition: (pos) => set({ hoverPosition: pos }),
    setFocusedCell: (pos) => set({ focusedCell: pos }),
    setEditingCell: (pos) => set({ editingCell: pos }),

    setRecords: (records) => set({ records }),

    loadView: (hydrated) =>
      set({
        viewId: hydrated.view._id,
        columns: hydrated.columns,
        density: hydrated.view.density,
        filters: hydrated.view.filters,
        sorts: hydrated.view.sorts,
        searchTerm: hydrated.view.searchTerm ?? "",
      }),
  }));
}

/* ----------------------- context & hooks ----------------------- */

export const RecordTableStoreContext = createContext<RecordTableStore | null>(null);

export function useRecordTableStoreOrThrow(): RecordTableStore {
  const store = useContext(RecordTableStoreContext);
  if (!store) {
    throw new Error(
      "useRecordTableStore must be used inside a <RecordTableScope>.",
    );
  }
  return store;
}

/**
 * Reactive selector hook — like Twenty's `useAtomComponentValue`. Pass
 * a selector function and the component re-renders when that slice
 * changes.
 */
export function useRecordTableState<T>(selector: (state: RecordTableState) => T): T {
  const store = useRecordTableStoreOrThrow();
  return useStore(store, selector);
}

/**
 * Imperative handle — for event handlers that don't need to re-render
 * on state changes. Analogous to Twenty's `useRecoilCallback`/Jotai's
 * `store.get`/`store.set`.
 */
export function useRecordTableStoreHandle() {
  const store = useRecordTableStoreOrThrow();
  return {
    get: store.getState,
    set: store.setState,
    subscribe: store.subscribe,
  };
}
