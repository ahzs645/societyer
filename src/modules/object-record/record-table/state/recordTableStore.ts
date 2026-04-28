import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";
import type {
  HydratedView,
  RecordField,
  ViewFilter,
  ViewFilterGroup,
  ViewFieldGroup,
  ViewGroup,
  ViewType,
  ViewOpenRecordIn,
  ViewSort,
  ViewVisibility,
} from "../../types";

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
  filterGroups: ViewFilterGroup[];
  sorts: ViewSort[];
  type: ViewType;
  kanbanFieldMetadataId?: string;
  calendarFieldMetadataId?: string;
  fieldGroups: ViewFieldGroup[];
  searchTerm: string;
  anyFieldFilterValue: string;
  viewGroups: ViewGroup[];
  visibility: ViewVisibility;
  openRecordIn: ViewOpenRecordIn;
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
  filterGroups: ViewFilterGroup[];
  setFilterGroups: (filterGroups: ViewFilterGroup[]) => void;
  sorts: ViewSort[];
  setSorts: (sorts: ViewSort[]) => void;
  type: ViewType;
  setType: (type: ViewType) => void;
  kanbanFieldMetadataId?: string;
  setKanbanFieldMetadataId: (fieldMetadataId?: string) => void;
  calendarFieldMetadataId?: string;
  setCalendarFieldMetadataId: (fieldMetadataId?: string) => void;
  fieldGroups: ViewFieldGroup[];
  setFieldGroups: (fieldGroups: ViewFieldGroup[]) => void;
  searchTerm: string;
  setSearchTerm: (searchTerm: string) => void;
  anyFieldFilterValue: string;
  setAnyFieldFilterValue: (anyFieldFilterValue: string) => void;
  viewGroups: ViewGroup[];
  setViewGroups: (viewGroups: ViewGroup[]) => void;
  visibility: ViewVisibility;
  setVisibility: (visibility: ViewVisibility) => void;
  openRecordIn: ViewOpenRecordIn;
  setOpenRecordIn: (openRecordIn: ViewOpenRecordIn) => void;

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
    filterGroups: [],
    sorts: [],
    type: "table",
    kanbanFieldMetadataId: undefined,
    calendarFieldMetadataId: undefined,
    fieldGroups: [],
    searchTerm: "",
    anyFieldFilterValue: "",
    viewGroups: [],
    visibility: "personal",
    openRecordIn: "drawer",
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
    setFilterGroups: (filterGroups) => set({ filterGroups }),
    setSorts: (sorts) => set({ sorts }),
    setType: (type) => set({ type }),
    setKanbanFieldMetadataId: (kanbanFieldMetadataId) => set({ kanbanFieldMetadataId }),
    setCalendarFieldMetadataId: (calendarFieldMetadataId) => set({ calendarFieldMetadataId }),
    setFieldGroups: (fieldGroups) => set({ fieldGroups }),
    setSearchTerm: (searchTerm) => set({ searchTerm }),
    setAnyFieldFilterValue: (anyFieldFilterValue) => set({ anyFieldFilterValue }),
    setViewGroups: (viewGroups) => set({ viewGroups }),
    setVisibility: (visibility) => set({ visibility }),
    setOpenRecordIn: (openRecordIn) => set({ openRecordIn }),

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
        filterGroups: hydrated.view.filterGroups,
        sorts: hydrated.view.sorts,
        type: hydrated.view.type,
        kanbanFieldMetadataId: hydrated.view.kanbanFieldMetadataId,
        calendarFieldMetadataId: hydrated.view.calendarFieldMetadataId,
        fieldGroups: hydrated.view.fieldGroups,
        searchTerm: hydrated.view.searchTerm ?? "",
        anyFieldFilterValue: hydrated.view.anyFieldFilterValue ?? "",
        viewGroups: hydrated.view.groups,
        visibility: hydrated.view.visibility,
        openRecordIn: hydrated.view.openRecordIn,
      };
      set({
        viewId: snapshot.viewId,
        columns: snapshot.columns,
        density: snapshot.density,
        filters: snapshot.filters,
        filterGroups: snapshot.filterGroups,
        sorts: snapshot.sorts,
        type: snapshot.type,
        kanbanFieldMetadataId: snapshot.kanbanFieldMetadataId,
        calendarFieldMetadataId: snapshot.calendarFieldMetadataId,
        fieldGroups: snapshot.fieldGroups,
        searchTerm: snapshot.searchTerm,
        anyFieldFilterValue: snapshot.anyFieldFilterValue,
        viewGroups: snapshot.viewGroups,
        visibility: snapshot.visibility,
        openRecordIn: snapshot.openRecordIn,
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
          filterGroups: s.filterGroups,
          sorts: s.sorts,
          type: s.type,
          kanbanFieldMetadataId: s.kanbanFieldMetadataId,
          calendarFieldMetadataId: s.calendarFieldMetadataId,
          fieldGroups: s.fieldGroups,
          searchTerm: s.searchTerm,
          anyFieldFilterValue: s.anyFieldFilterValue,
          viewGroups: s.viewGroups,
          visibility: s.visibility,
          openRecordIn: s.openRecordIn,
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
        filterGroups: snap.filterGroups,
        sorts: snap.sorts,
        type: snap.type,
        kanbanFieldMetadataId: snap.kanbanFieldMetadataId,
        calendarFieldMetadataId: snap.calendarFieldMetadataId,
        fieldGroups: snap.fieldGroups,
        searchTerm: snap.searchTerm,
        anyFieldFilterValue: snap.anyFieldFilterValue,
        viewGroups: snap.viewGroups,
        visibility: snap.visibility,
        openRecordIn: snap.openRecordIn,
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

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
    s.anyFieldFilterValue !== snap.anyFieldFilterValue ||
    s.type !== snap.type ||
    s.kanbanFieldMetadataId !== snap.kanbanFieldMetadataId ||
    s.calendarFieldMetadataId !== snap.calendarFieldMetadataId ||
    s.visibility !== snap.visibility ||
    s.openRecordIn !== snap.openRecordIn ||
    !filtersEqual(s.filters, snap.filters) ||
    !jsonEqual(s.filterGroups, snap.filterGroups) ||
    !jsonEqual(s.fieldGroups, snap.fieldGroups) ||
    !jsonEqual(s.viewGroups, snap.viewGroups) ||
    !sortsEqual(s.sorts, snap.sorts) ||
    !columnsEqual(s.columns, snap.columns)
  );
}

/** Returns true whenever the live view state differs from what's saved on the server. */
export function useRecordTableIsDirty(): boolean {
  return useRecordTableState(computeIsDirty);
}
