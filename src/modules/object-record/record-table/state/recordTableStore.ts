import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";
import type { HydratedView, RecordField, ViewFilter, ViewSort } from "../../types";

/**
 * Per-table-instance state. Mirrors Twenty's `createAtomComponentState`
 * pattern: every RecordTable on the page has its own independent store
 * (for selection, hover, focus, column widths, etc.), and components
 * inside it pull the store from context.
 *
 * ## Draft vs. saved
 *
 * View-level fields (columns / filters / sorts / density / searchTerm)
 * live at the top level as the *live* values — that's what the UI reads
 * and writes. `savedView` holds a snapshot of the last DB-synced state.
 * `isDirty` (selector) is true whenever live ≠ savedView, which drives
 * "You have unsaved changes" indicators. `markSaved()` promotes live
 * into savedView after a successful server write; `discardDraftChanges()`
 * throws away live edits and restores savedView. Interaction state
 * (selection / hover / focus / records) is intentionally *not* split —
 * dirty-checking those would be noise.
 */

export type CellPosition = { rowIndex: number; columnIndex: number };

type SavedViewSnapshot = {
  viewId: string | null;
  columns: RecordField[];
  density: "compact" | "comfortable";
  filters: ViewFilter[];
  sorts: ViewSort[];
  searchTerm: string;
};

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

  /* draft / current split */
  savedView: SavedViewSnapshot | null;
  /** Load a view from the server — replaces both live state and savedView. */
  loadView: (hydrated: HydratedView) => void;
  /** Promote current live state into savedView (call after server save). */
  markSaved: () => void;
  /** Restore live state to savedView, throwing away unsaved edits. */
  discardDraftChanges: () => void;
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
    savedView: null,

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

    loadView: (hydrated) => {
      const snapshot: SavedViewSnapshot = {
        viewId: hydrated.view._id,
        columns: hydrated.columns,
        density: hydrated.view.density,
        filters: hydrated.view.filters,
        sorts: hydrated.view.sorts,
        searchTerm: hydrated.view.searchTerm ?? "",
      };
      set({
        viewId: snapshot.viewId,
        columns: snapshot.columns,
        density: snapshot.density,
        filters: snapshot.filters,
        sorts: snapshot.sorts,
        searchTerm: snapshot.searchTerm,
        savedView: snapshot,
      });
    },

    markSaved: () => {
      const s = get();
      set({
        savedView: {
          viewId: s.viewId,
          columns: s.columns,
          density: s.density,
          filters: s.filters,
          sorts: s.sorts,
          searchTerm: s.searchTerm,
        },
      });
    },

    discardDraftChanges: () => {
      const snap = get().savedView;
      if (!snap) return;
      set({
        viewId: snap.viewId,
        columns: snap.columns,
        density: snap.density,
        filters: snap.filters,
        sorts: snap.sorts,
        searchTerm: snap.searchTerm,
      });
    },
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

/* ----------------------- dirty-checking ----------------------- */

function filtersEqual(a: ViewFilter[], b: ViewFilter[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.fieldMetadataId !== y.fieldMetadataId ||
      x.operator !== y.operator ||
      JSON.stringify(x.value) !== JSON.stringify(y.value)
    ) {
      return false;
    }
  }
  return true;
}

function sortsEqual(a: ViewSort[], b: ViewSort[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].fieldMetadataId !== b[i].fieldMetadataId ||
      a[i].direction !== b[i].direction
    ) {
      return false;
    }
  }
  return true;
}

function columnsEqual(a: RecordField[], b: RecordField[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].viewFieldId !== b[i].viewFieldId ||
      a[i].position !== b[i].position ||
      a[i].size !== b[i].size ||
      a[i].isVisible !== b[i].isVisible
    ) {
      return false;
    }
  }
  return true;
}

export function computeIsDirty(s: RecordTableState): boolean {
  const snap = s.savedView;
  if (!snap) return false;
  return (
    s.viewId !== snap.viewId ||
    s.density !== snap.density ||
    s.searchTerm !== snap.searchTerm ||
    !filtersEqual(s.filters, snap.filters) ||
    !sortsEqual(s.sorts, snap.sorts) ||
    !columnsEqual(s.columns, snap.columns)
  );
}

/** Returns true whenever the live view state differs from what's saved on the server. */
export function useRecordTableIsDirty(): boolean {
  return useRecordTableState(computeIsDirty);
}
