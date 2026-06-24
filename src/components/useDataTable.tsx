// DataTable state + behavior extracted from DataTable.tsx into a hook so the
// component file is presentation-focused. Pure logic move (verbatim body).

import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ViewBar } from "./primitives";
import {
  AppliedFilter,
  FilterChips,
  FilterField,
  FilterGroup,
  FilterPopover,
  applyFilters,
  evaluateGroup,
} from "./FilterBar";
import { AdvancedFilterModal } from "./AdvancedFilter";
import { MenuRow, MenuSectionLabel, Pill, Skeleton } from "./ui";
import { useIsMobileCards } from "../lib/useIsMobileCards";
import {
  makeViewId,
  readSavedViews,
  savedViewFromWorkspaceView,
  savedViewToWorkspacePayload,
  writeSavedViews,
  type SavedView,
  type SharedSavedViewsContext,
} from "../lib/savedViews";
import { useUIStore } from "../lib/store";
import { cellToText, copyAsTsv } from "../lib/clipboard";
import { useToast } from "./Toast";
import { api } from "../lib/convexApi";
import { Select } from "./Select";
import { NameAutocomplete } from "./NameAutocomplete";

import {
  EMPTY_ARR,
  SortPopover,
  OptionsPopover,
  EditableCell,
  EditPopover,
  ColumnResizeHandle,
  TableScrollWrap,
} from "./DataTable.internal";
import type { Column, SortState, BulkAction, EditableCellConfig } from "./DataTable";

export type DataTableProps<T extends { _id?: string } & Record<string, any>> = {
  label: string;
  icon?: ReactNode;
  data: T[];
  columns: Column<T>[];
  /** When true, replaces rows with skeleton placeholders. Callers should
   * pass `loading={myQuery === undefined}` for Convex useQuery results. */
  loading?: boolean;
  filterFields?: FilterField<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Overrides the first-cell button click. Falls back to onRowClick. Use when
   * the primary cell (typically the title) should navigate to a detail page
   * while the rest of the row does something else (e.g. open an edit drawer). */
  onPrimaryCellClick?: (row: T) => void;
  /** Fires on row right-click. Caller should preventDefault and show its own menu. */
  onRowContextMenu?: (event: React.MouseEvent, row: T) => void;
  /** "row" (default) makes the whole tr clickable. "first-cell" only wraps the
   * first cell in a button — useful when you want a context menu / kebab to
   * provide other row actions without the whole row swallowing clicks. */
  rowClickScope?: "row" | "first-cell";
  searchPlaceholder?: string;
  emptyMessage?: ReactNode;
  defaultSort?: SortState;
  /** Extra row getters searched alongside column accessors. */
  searchExtraFields?: ((row: T) => string | undefined | null)[];
  /** Rendered in a trailing action column. */
  renderRowActions?: (row: T) => ReactNode;
  /** Accessible label for clickable rows. */
  rowActionLabel?: (row: T) => string;
  /** Opt-in client-side pagination for long result sets. */
  pagination?: boolean;
  initialPageSize?: number;
  pageSizeOptions?: number[];
  /** When provided, enables row selection with a sticky bulk-action toolbar. */
  bulkActions?: BulkAction<T>[];
  /** Enables "saved views" (filter + sort + columns + density) keyed by this
   * stable string. Persisted to localStorage unless sharedViewsContext is
   * provided, in which case Convex workspace metadata is used. */
  viewsKey?: string;
  sharedViewsContext?: SharedSavedViewsContext;
};

export function useDataTable<T extends { _id?: string } & Record<string, any>>(props: DataTableProps<T>) {
  const {
  label,
  icon,
  data,
  columns,
  filterFields,
  rowKey,
  onRowClick,
  onPrimaryCellClick,
  onRowContextMenu,
  rowClickScope = "row",
  searchPlaceholder,
  emptyMessage = "No rows.",
  defaultSort,
  searchExtraFields,
  renderRowActions,
  rowActionLabel,
  pagination = false,
  initialPageSize = 10,
  pageSizeOptions = [10, 25, 50],
  bulkActions,
  viewsKey,
  sharedViewsContext,
  loading = false,
  } = props;
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<AppliedFilter[]>([]);
  const [advanced, setAdvanced] = useState<FilterGroup | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(defaultSort ?? null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const isMobileCards = useIsMobileCards();
  const selectionScope = viewsKey ?? `table:${label}`;
  const selectionList = useUIStore((s) => s.selection[selectionScope] ?? EMPTY_ARR);
  const selected = useMemo(() => new Set(selectionList), [selectionList]);
  const setSelected = useCallback(
    (next: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const store = useUIStore.getState();
      const prev = new Set(store.selection[selectionScope] ?? []);
      const resolved = typeof next === "function" ? (next as any)(prev) : next;
      store.setSelection(selectionScope, Array.from(resolved));
    },
    [selectionScope],
  );
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>(() =>
    viewsKey ? readSavedViews(viewsKey) : [],
  );
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const location = useLocation();
  const sharedViewsEnabled = Boolean(
    viewsKey &&
      sharedViewsContext?.societyId &&
      (sharedViewsContext.objectMetadataId || sharedViewsContext.nameSingular),
  );
  const workspaceViews = useQuery(
    api.views.listSharedForDataTable,
    sharedViewsEnabled
      ? {
          societyId: sharedViewsContext!.societyId as any,
          ...(sharedViewsContext!.objectMetadataId
            ? { objectMetadataId: sharedViewsContext!.objectMetadataId as any }
            : {}),
          ...(sharedViewsContext!.nameSingular
            ? { nameSingular: sharedViewsContext!.nameSingular }
            : {}),
        }
      : "skip",
  );
  const createWorkspaceView = useMutation(api.views.createSharedDataTableView);
  const deleteWorkspaceView = useMutation(api.views.deleteSharedDataTableView);

  useEffect(() => {
    if (!viewsKey) {
      setSavedViews([]);
      return;
    }
    if (sharedViewsEnabled) return;
    setSavedViews(readSavedViews(viewsKey));
  }, [viewsKey, sharedViewsEnabled]);

  useEffect(() => {
    if (!sharedViewsEnabled || workspaceViews === undefined) return;
    setSavedViews((workspaceViews ?? []).map(savedViewFromWorkspaceView));
  }, [sharedViewsEnabled, workspaceViews]);

  useEffect(() => {
    if (!viewsKey) return;
    if (activeViewId) return; // don't clobber a manual selection
    const params = new URLSearchParams(location.search);
    const target =
      params.get("view") ??
      useUIStore.getState().lastViewByModule[viewsKey] ??
      null;
    if (!target) return;
    const match = savedViews.find((v) => v.id === target);
    if (match) {
      setFilters(match.filters);
      setSort(match.sort);
      setQ(match.searchTerm ?? "");
      setHiddenColumns(new Set(match.hiddenColumns));
      setColumnWidths(match.columnWidths ?? {});
      setDensity(match.density);
      setActiveViewId(match.id);
    }
  }, [viewsKey, location.pathname, location.search, savedViews]);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const selectable = Boolean(bulkActions && bulkActions.length > 0);
  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.has(col.id)),
    [columns, hiddenColumns],
  );

  const sortColumn = sort ? columns.find((column) => column.id === sort.columnId) : null;
  const sortableColumns = useMemo(() => columns.filter((c) => c.sortable), [columns]);
  const effectivePageSizeOptions = useMemo(
    () => Array.from(new Set([initialPageSize, ...pageSizeOptions])).filter((size) => size > 0).sort((a, b) => a - b),
    [initialPageSize, pageSizeOptions],
  );

  const effectiveFilterFields = useMemo<FilterField<T>[] | undefined>(() => {
    if (!filterFields) return undefined;
    const anyField: FilterField<T> = {
      id: "__any__",
      label: "Any field",
      match: (record, query) => {
        const ql = query.toLowerCase();
        const pieces = [
          ...columns.map((c) => c.accessor?.(record)),
          ...(searchExtraFields?.map((fn) => fn(record)) ?? []),
        ];
        return pieces.some((p) => String(p ?? "").toLowerCase().includes(ql));
      },
    };
    return [anyField, ...filterFields];
  }, [filterFields, columns, searchExtraFields]);

  const filtered = useMemo(() => {
    let rows = data;
    if (effectiveFilterFields && filters.length > 0) {
      rows = applyFilters(rows, filters, effectiveFilterFields);
    }
    if (effectiveFilterFields && advanced && advanced.rules.length > 0) {
      rows = rows.filter((r) => evaluateGroup(r, advanced, effectiveFilterFields));
    }
    if (q.trim()) {
      const ql = q.toLowerCase();
      rows = rows.filter((r) => {
        const pieces = [
          ...columns.map((c) => c.accessor?.(r)),
          ...(searchExtraFields?.map((fn) => fn(r)) ?? []),
        ];
        return pieces.some((p) => String(p ?? "").toLowerCase().includes(ql));
      });
    }
    if (sort) {
      const col = columns.find((c) => c.id === sort.columnId);
      if (col?.accessor) {
        rows = [...rows].sort((a, b) => {
          const av = col.accessor!(a);
          const bv = col.accessor!(b);
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (typeof av === "number" && typeof bv === "number") {
            return sort.dir === "asc" ? av - bv : bv - av;
          }
          const as = String(av);
          const bs = String(bv);
          return sort.dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
        });
      }
    }
    return rows;
  }, [data, filters, advanced, q, sort, columns, effectiveFilterFields, searchExtraFields]);

  const totalPages = pagination ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const visibleRows = pagination ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered;
  const pageStart = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = pagination ? Math.min(page * pageSize, filtered.length) : filtered.length;

  useEffect(() => {
    setPage(1);
  }, [q, filters, sort, data.length, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), totalPages));
  }, [totalPages]);

  // Drop selection entries that no longer match the current filter/search.
  useEffect(() => {
    if (!selectable || selected.size === 0) return;
    const keep = new Set(filtered.map((row) => rowKey(row)));
    let changed = false;
    const next = new Set<string>();
    for (const id of selected) {
      if (keep.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelected(next);
  }, [filtered, selectable]); // rowKey is stable per render; skip as dep

  const selectedRows = useMemo(
    () => (selectable ? filtered.filter((row) => selected.has(rowKey(row))) : []),
    [filtered, selected, selectable],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (!focusedCell) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(event.key)) return;

      const rowCount = visibleRows.length;
      const colCount = visibleColumns.length;
      if (rowCount === 0 || colCount === 0) return;
      const current = focusedCell;

      if (event.key === "Escape") {
        setFocusedCell(null);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const selector = `td[data-row-index="${current.row}"][data-col-index="${current.col}"] .editable-cell`;
        const btn = document.querySelector<HTMLButtonElement>(selector);
        if (btn) btn.click();
        return;
      }
      event.preventDefault();
      const next = { ...current };
      if (event.key === "ArrowUp") next.row = Math.max(0, current.row - 1);
      if (event.key === "ArrowDown") next.row = Math.min(rowCount - 1, current.row + 1);
      if (event.key === "ArrowLeft") next.col = Math.max(0, current.col - 1);
      if (event.key === "ArrowRight") next.col = Math.min(colCount - 1, current.col + 1);
      setFocusedCell(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleRows.length, visibleColumns.length, focusedCell]);

  const toast = useToast();
  useEffect(() => {
    if (!selectable) return;
    const onKey = async (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== "c") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (selectedRows.length === 0) return;
      const selection = window.getSelection?.();
      if (selection && selection.toString().length > 0) return;
      event.preventDefault();
      const header = visibleColumns.map((c) =>
        typeof c.header === "string" ? c.header : c.id,
      );
      const body = selectedRows.map((row) =>
        visibleColumns.map((c) =>
          c.render ? cellToText(c.render(row)) : String(c.accessor?.(row) ?? ""),
        ),
      );
      const ok = await copyAsTsv([header, ...body]);
      if (ok) toast.success(`Copied ${selectedRows.length} row${selectedRows.length === 1 ? "" : "s"}`);
      else toast.error("Clipboard not available");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectable, selectedRows, visibleColumns, toast]);
  const allVisibleSelected =
    selectable && filtered.length > 0 && filtered.every((row) => selected.has(rowKey(row)));
  const someVisibleSelected =
    selectable && !allVisibleSelected && filtered.some((row) => selected.has(rowKey(row)));

  const lastRowIndexRef = useRef<number | null>(null);
  const toggleRow = (row: T, event?: React.MouseEvent | React.ChangeEvent) => {
    const id = rowKey(row);
    const native = (event as any)?.nativeEvent ?? event;
    const shift = native instanceof Event
      ? (native as MouseEvent).shiftKey === true
      : (event as React.MouseEvent)?.shiftKey === true;
    const currentIndex = filtered.findIndex((r) => rowKey(r) === id);
    if (shift && lastRowIndexRef.current != null && currentIndex >= 0) {
      const [from, to] = [lastRowIndexRef.current, currentIndex].sort((a, b) => a - b);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i += 1) {
          next.add(rowKey(filtered[i]));
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastRowIndexRef.current = currentIndex;
  };
  const toggleAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const row of filtered) next.delete(rowKey(row));
        return next;
      }
      const next = new Set(prev);
      for (const row of filtered) next.add(rowKey(row));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const runBulkAction = async (action: BulkAction<T>) => {
    if (selectedRows.length === 0) return;
    await action.onRun(selectedRows);
    if (!action.keepSelection) clearSelection();
  };

  const saveView = async (name: string) => {
    if (!viewsKey) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const view: SavedView = {
      id: makeViewId(),
      name: trimmed,
      filters,
      sort,
      searchTerm: q.trim() || undefined,
      hiddenColumns: [...hiddenColumns],
      columnWidths,
      density,
      createdAtISO: new Date().toISOString(),
    };
    if (sharedViewsEnabled && sharedViewsContext) {
      const optimistic = { ...view, isShared: true };
      setSavedViews((current) => [...current, optimistic]);
      setActiveViewId(optimistic.id);
      let workspaceId: string | null = null;
      let workspaceError: unknown = null;
      try {
        const id = await createWorkspaceView({
          societyId: sharedViewsContext.societyId as any,
          ...(sharedViewsContext.objectMetadataId
            ? { objectMetadataId: sharedViewsContext.objectMetadataId as any }
            : {}),
          ...(sharedViewsContext.nameSingular
            ? { nameSingular: sharedViewsContext.nameSingular }
            : {}),
          ...(sharedViewsContext.createdByUserId
            ? { createdByUserId: sharedViewsContext.createdByUserId as any }
            : {}),
          ...savedViewToWorkspacePayload(view),
        });
        if (id != null) workspaceId = String(id);
      } catch (error) {
        workspaceError = error;
      }
      if (workspaceId) {
        setActiveViewId(workspaceId);
        return;
      }
      setSavedViews((current) => current.filter((candidate) => candidate.id !== optimistic.id));
      if (workspaceError) {
        toast.error("Saved locally", workspaceError instanceof Error ? workspaceError.message : "Shared view could not be saved.");
      }
      const localNext = [...readSavedViews(viewsKey), view];
      writeSavedViews(viewsKey, localNext);
      setSavedViews(localNext);
      return;
    }
    const next = [...savedViews, view];
    setSavedViews(next);
    writeSavedViews(viewsKey, next);
    setActiveViewId(view.id);
  };
  const applyView = (view: SavedView) => {
    setFilters(view.filters);
    setSort(view.sort);
    setQ(view.searchTerm ?? "");
    setHiddenColumns(new Set(view.hiddenColumns));
    setColumnWidths(view.columnWidths ?? {});
    setDensity(view.density);
    setActiveViewId(view.id);
    if (viewsKey) useUIStore.getState().setLastView(viewsKey, view.id);
  };
  const togglePin = (view: SavedView) => {
    if (!viewsKey) return;
    const s = useUIStore.getState();
    if (s.isViewPinned(viewsKey, view.id)) {
      s.unpinView(viewsKey, view.id);
    } else {
      s.pinView({
        viewsKey,
        viewId: view.id,
        label: view.name,
        to: location.pathname,
      });
    }
  };
  const deleteView = async (id: string) => {
    if (!viewsKey) return;
    if (sharedViewsEnabled && sharedViewsContext) {
      const target = savedViews.find((view) => view.id === id);
      if (target?.isSystem) return;
      setSavedViews((current) => current.filter((v) => v.id !== id));
      if (activeViewId === id) setActiveViewId(null);
      try {
        await deleteWorkspaceView({
          societyId: sharedViewsContext.societyId as any,
          id: id as any,
        });
      } catch (error) {
        toast.error("Could not delete shared view", error instanceof Error ? error.message : undefined);
      }
      return;
    }
    const next = savedViews.filter((v) => v.id !== id);
    setSavedViews(next);
    writeSavedViews(viewsKey, next);
    if (activeViewId === id) setActiveViewId(null);
  };

  const toggleSort = (columnId: string) => {
    const col = columns.find((c) => c.id === columnId);
    if (!col?.sortable) return;
    setSort((s) =>
      !s || s.columnId !== columnId
        ? { columnId, dir: "asc" }
        : s.dir === "asc"
          ? { columnId, dir: "desc" }
          : null,
    );
  };

  return {
    label,
    icon,
    data,
    columns,
    filterFields,
    rowKey,
    onRowClick,
    onPrimaryCellClick,
    onRowContextMenu,
    rowClickScope,
    searchPlaceholder,
    emptyMessage,
    renderRowActions,
    rowActionLabel,
    pagination,
    bulkActions,
    viewsKey,
    loading,
    q,
    setQ,
    filters,
    setFilters,
    advanced,
    setAdvanced,
    advancedOpen,
    setAdvancedOpen,
    filterOpen,
    setFilterOpen,
    sortOpen,
    setSortOpen,
    sort,
    setSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    isMobileCards,
    selected,
    hiddenColumns,
    setHiddenColumns,
    density,
    setDensity,
    focusedCell,
    setFocusedCell,
    columnWidths,
    setColumnWidths,
    optionsOpen,
    setOptionsOpen,
    savedViews,
    activeViewId,
    sharedViewsEnabled,
    filterBtnRef,
    sortBtnRef,
    optionsBtnRef,
    selectable,
    visibleColumns,
    sortColumn,
    sortableColumns,
    effectivePageSizeOptions,
    effectiveFilterFields,
    filtered,
    totalPages,
    visibleRows,
    pageStart,
    pageEnd,
    selectedRows,
    allVisibleSelected,
    someVisibleSelected,
    toggleRow,
    toggleAllVisible,
    clearSelection,
    runBulkAction,
    saveView,
    applyView,
    togglePin,
    deleteView,
    toggleSort,
  };
}
