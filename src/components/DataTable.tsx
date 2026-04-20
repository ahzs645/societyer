import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { ViewBar } from "./primitives";
import {
  AppliedFilter,
  FilterChips,
  FilterField,
  FilterPopover,
  applyFilters,
} from "./FilterBar";
import { MenuRow, MenuSectionLabel, Pill } from "./ui";
import { mobileCardMediaQuery } from "../lib/breakpoints";
import {
  makeViewId,
  readSavedViews,
  writeSavedViews,
  type SavedView,
} from "../lib/savedViews";

export type Column<T> = {
  id: string;
  header: ReactNode;
  /** Returns a primitive used for sorting and for the default search match. */
  accessor?: (row: T) => string | number | boolean | null | undefined;
  /** Cell renderer. If omitted, the accessor's value is rendered as text. */
  render?: (row: T) => ReactNode;
  width?: number | string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  className?: string;
};

export type SortState = { columnId: string; dir: "asc" | "desc" } | null;

export type BulkAction<T> = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Clears the selection after a successful run unless `keepSelection` is set. */
  onRun: (rows: T[]) => void | Promise<void>;
  /** Visual tone — destructive gets a danger-tinted button. */
  tone?: "default" | "danger";
  keepSelection?: boolean;
};

export function DataTable<T extends { _id?: string } & Record<string, any>>({
  label,
  icon,
  data,
  columns,
  filterFields,
  rowKey,
  onRowClick,
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
  loading = false,
}: {
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
  searchPlaceholder?: string;
  emptyMessage?: string;
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
   * stable string. Persisted to localStorage. */
  viewsKey?: string;
}) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<AppliedFilter[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(defaultSort ?? null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [isMobileCards, setIsMobileCards] = useState(
    () => window.matchMedia(mobileCardMediaQuery).matches,
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>(() =>
    viewsKey ? readSavedViews(viewsKey) : [],
  );
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const selectable = Boolean(bulkActions && bulkActions.length > 0);
  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.has(col.id)),
    [columns, hiddenColumns],
  );

  useEffect(() => {
    const mq = window.matchMedia(mobileCardMediaQuery);
    const onChange = (e: MediaQueryListEvent) => setIsMobileCards(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const sortColumn = sort ? columns.find((column) => column.id === sort.columnId) : null;
  const sortableColumns = useMemo(() => columns.filter((c) => c.sortable), [columns]);
  const effectivePageSizeOptions = useMemo(
    () => Array.from(new Set([initialPageSize, ...pageSizeOptions])).filter((size) => size > 0).sort((a, b) => a - b),
    [initialPageSize, pageSizeOptions],
  );

  const filtered = useMemo(() => {
    let rows = data;
    if (filterFields && filters.length > 0) {
      rows = applyFilters(rows, filters, filterFields);
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
  }, [data, filters, q, sort, columns, filterFields, searchExtraFields]);

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
  const allVisibleSelected =
    selectable && filtered.length > 0 && filtered.every((row) => selected.has(rowKey(row)));
  const someVisibleSelected =
    selectable && !allVisibleSelected && filtered.some((row) => selected.has(rowKey(row)));

  const toggleRow = (row: T) => {
    const id = rowKey(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const saveView = (name: string) => {
    if (!viewsKey) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const view: SavedView = {
      id: makeViewId(),
      name: trimmed,
      filters,
      sort,
      hiddenColumns: [...hiddenColumns],
      density,
      createdAtISO: new Date().toISOString(),
    };
    const next = [...savedViews, view];
    setSavedViews(next);
    writeSavedViews(viewsKey, next);
    setActiveViewId(view.id);
  };
  const applyView = (view: SavedView) => {
    setFilters(view.filters);
    setSort(view.sort);
    setHiddenColumns(new Set(view.hiddenColumns));
    setDensity(view.density);
    setActiveViewId(view.id);
  };
  const deleteView = (id: string) => {
    if (!viewsKey) return;
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

  return (
    <div className="table-wrap" style={{ position: "relative" }}>
      <ViewBar
        label={label}
        count={filtered.length}
        icon={icon}
        filterBtnRef={filterBtnRef}
        sortBtnRef={sortBtnRef}
        optionsBtnRef={optionsBtnRef}
        onFilter={
          filterFields?.length
            ? () => {
                setFilterOpen((v) => !v);
                setSortOpen(false);
                setOptionsOpen(false);
              }
            : undefined
        }
        onSort={
          sortableColumns.length
            ? () => {
                setSortOpen((v) => !v);
                setFilterOpen(false);
                setOptionsOpen(false);
              }
            : undefined
        }
        onOptions={() => {
          setOptionsOpen((v) => !v);
          setFilterOpen(false);
          setSortOpen(false);
        }}
      />
      {optionsOpen && (
        <OptionsPopover
          columns={columns}
          hidden={hiddenColumns}
          onToggleColumn={(id) => {
            setHiddenColumns((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onResetColumns={() => setHiddenColumns(new Set())}
          density={density}
          onDensity={setDensity}
          savedViews={viewsKey ? savedViews : undefined}
          activeViewId={activeViewId}
          onApplyView={applyView}
          onSaveView={saveView}
          onDeleteView={deleteView}
          anchorRef={optionsBtnRef as any}
          onClose={() => setOptionsOpen(false)}
        />
      )}
      {filterFields && (
        <FilterChips
          filters={filters}
          fields={filterFields}
          onRemove={(i) => setFilters(filters.filter((_, idx) => idx !== i))}
        />
      )}
      {filterOpen && filterFields && (
        <FilterPopover
          fields={filterFields}
          anchorRef={filterBtnRef as any}
          onAdd={(f) => setFilters([...filters, f])}
          onClose={() => setFilterOpen(false)}
        />
      )}
      {sortOpen && (
        <SortPopover
          columns={sortableColumns}
          anchorRef={sortBtnRef as any}
          current={sort}
          onPick={(s) => {
            setSort(s);
            setSortOpen(false);
          }}
          onClose={() => setSortOpen(false)}
        />
      )}

      <div className="table-toolbar">
        <div className="table-toolbar__search">
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder ?? "Search…"}
            aria-label={`${label} search`}
          />
        </div>
        {sortColumn && (
          <div className="table-toolbar__state">
            <span className="muted">Sorted by</span>
            <Pill size="sm">
              {typeof sortColumn.header === "string" ? sortColumn.header : sortColumn.id} {sort?.dir === "asc" ? "↑" : "↓"}
            </Pill>
          </div>
        )}
        <div className="muted table-toolbar__summary">
          {filtered.length} of {data.length}
        </div>
      </div>

      {isMobileCards ? (
        <div className="card-list" role="list" aria-label={label}>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={`sk-${i}`} className="card-list__item" role="listitem" aria-busy="true">
                <div className="card-list__primary">
                  <div className="card-list__primary-cell">
                    <Skeleton variant="line" width="60%" height={12} />
                  </div>
                </div>
                <div className="card-list__details">
                  <Skeleton variant="line" width="40%" height={10} />
                  <Skeleton variant="line" width="30%" height={10} />
                </div>
              </div>
            ))
          ) : (
          <>
          {visibleRows.map((row) => {
            const primaryCol = visibleColumns[0] ?? columns[0];
            const secondaryCols = visibleColumns.slice(1);
            const primaryCell = primaryCol.render
              ? primaryCol.render(row)
              : String(primaryCol.accessor?.(row) ?? "");
            return (
              <div
                key={rowKey(row)}
                className={`card-list__item${onRowClick ? " card-list__item--interactive" : ""}`}
                role="listitem"
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                <div className="card-list__primary">
                  <div className="card-list__primary-cell">{primaryCell}</div>
                  {renderRowActions && (
                    <div
                      className="card-list__actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderRowActions(row)}
                    </div>
                  )}
                </div>
                {secondaryCols.length > 0 && (
                  <div className="card-list__details">
                    {secondaryCols.map((col) => {
                      const cell = col.render
                        ? col.render(row)
                        : String(col.accessor?.(row) ?? "");
                      return (
                        <div key={col.id} className="card-list__detail">
                          <span className="card-list__detail-label">
                            {col.header}
                          </span>
                          <span className="card-list__detail-value">{cell}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="table__empty">
              {data.length === 0
                ? emptyMessage
                : "No rows match the current filters."}
            </div>
          )}
          </>
          )}
        </div>
      ) : (
      <table className={`table${density === "comfortable" ? " table--comfortable" : ""}`}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {selectable && (
              <th className="table__select-col">
                <input
                  type="checkbox"
                  aria-label={allVisibleSelected ? `Deselect all ${label}` : `Select all ${label}`}
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                />
              </th>
            )}
            {visibleColumns.map((col) => (
              <th
                key={col.id}
                className={col.sortable ? "is-sortable" : undefined}
                aria-sort={
                  col.sortable
                    ? sort?.columnId === col.id
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                    : undefined
                }
                style={{
                  width: col.width,
                  textAlign: col.align,
                }}
              >
                {col.sortable ? (
                  <button
                    type="button"
                    className="table__sort-button"
                    onClick={() => toggleSort(col.id)}
                    aria-label={
                      sort?.columnId === col.id
                        ? `Sorted ${sort.dir === "asc" ? "ascending" : "descending"} — click to ${sort.dir === "asc" ? "sort descending" : "clear sort"}`
                        : "Click to sort ascending"
                    }
                  >
                    <span>{col.header}</span>
                    {sort?.columnId === col.id && (
                      <span className="table__sort-indicator" aria-hidden="true">
                        {sort.dir === "asc" ? <ArrowUp /> : <ArrowDown />}
                      </span>
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
            {renderRowActions && <th className="table__actions-col" />}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} aria-busy="true">
                  {selectable && (
                    <td className="table__select-cell">
                      <Skeleton variant="block" width={14} height={14} radius={3} />
                    </td>
                  )}
                  {visibleColumns.map((col, ci) => (
                    <td key={col.id} style={{ textAlign: col.align }}>
                      <Skeleton
                        variant="line"
                        height={10}
                        width={ci === 0 ? "65%" : ci === visibleColumns.length - 1 ? "35%" : "50%"}
                      />
                    </td>
                  ))}
                  {renderRowActions && <td className="table__actions" />}
                </tr>
              ))
            : null}
          {!loading && visibleRows.map((row) => {
            const id = rowKey(row);
            const isSelected = selectable && selected.has(id);
            return (
            <tr
              key={id}
              className={`${renderRowActions ? "table__row--actions " : ""}${isSelected ? "is-selected" : ""}`.trim() || undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? "pointer" : undefined }}
              aria-selected={selectable ? isSelected : undefined}
            >
              {selectable && (
                <td className="table__select-cell" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={isSelected ? `Deselect row` : `Select row`}
                    checked={isSelected}
                    onChange={() => toggleRow(row)}
                  />
                </td>
              )}
              {visibleColumns.map((col, index) => {
                const cell = col.render ? col.render(row) : String(col.accessor?.(row) ?? "");
                return (
                <td
                  key={col.id}
                  className={col.className}
                  style={{ textAlign: col.align }}
                >
                  {onRowClick && index === 0 ? (
                    <button
                      type="button"
                      className="table__cell-button"
                      aria-label={rowActionLabel?.(row) ?? `Open ${label} row`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRowClick(row);
                      }}
                    >
                      {cell}
                    </button>
                  ) : (
                    cell
                  )}
                </td>
                );
              })}
              {renderRowActions && (
                <td
                  className="table__actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="table__actions-inner">
                    {renderRowActions(row)}
                  </div>
                </td>
              )}
            </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td
                colSpan={visibleColumns.length + (renderRowActions ? 1 : 0) + (selectable ? 1 : 0)}
                className="table__empty"
              >
                {data.length === 0 ? emptyMessage : "No rows match the current filters."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      )}
      {selectable && selectedRows.length > 0 && (
        <div className="table-bulkbar" role="region" aria-label="Bulk actions">
          <button
            type="button"
            className="table-bulkbar__clear"
            onClick={clearSelection}
            aria-label="Clear selection"
          >
            <X size={14} />
          </button>
          <span className="table-bulkbar__count">
            {selectedRows.length} selected
          </span>
          <div className="table-bulkbar__actions">
            {bulkActions!.map((action) => (
              <button
                key={action.id}
                type="button"
                className={`btn btn--sm${action.tone === "danger" ? " btn--danger" : ""}`}
                onClick={() => runBulkAction(action)}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {pagination && filtered.length > 0 && (
        <div className="table-pagination">
          <div className="table-pagination__range">
            Showing {pageStart}-{pageEnd} of {filtered.length}
          </div>
          <label className="table-pagination__size">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              {effectivePageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <div className="table-pagination__controls" aria-label={`${label} pagination`}>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={12} />
            </button>
            <span className="table-pagination__page">Page {page} of {totalPages}</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label="Next page"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortPopover<T>({
  columns,
  anchorRef,
  current,
  onPick,
  onClose,
}: {
  columns: Column<T>[];
  anchorRef: React.RefObject<HTMLElement>;
  current: SortState;
  onPick: (s: SortState) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, anchorRef]);

  const rect = anchorRef.current?.getBoundingClientRect();
  const POPOVER_W = 240;
  const POPOVER_H = 280;
  const margin = 8;
  const style = rect
    ? {
        top: Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - POPOVER_H - margin)),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - POPOVER_W - margin)),
      }
    : { top: 48, left: 16 };

  return (
    <div className="popover" ref={ref} style={style}>
      <MenuSectionLabel>Sort ascending</MenuSectionLabel>
      {columns.map((c) => (
        <MenuRow
          key={c.id}
          label={typeof c.header === "string" ? c.header : c.id}
          hint="Ascending"
          right={current?.columnId === c.id && current?.dir === "asc" ? <Pill size="sm">Current</Pill> : null}
          onClick={() => onPick({ columnId: c.id, dir: "asc" })}
        />
      ))}
      <div className="menu__separator" />
      <MenuSectionLabel>Sort descending</MenuSectionLabel>
      {columns.map((c) => (
        <MenuRow
          key={c.id + "-d"}
          label={typeof c.header === "string" ? c.header : c.id}
          hint="Descending"
          right={current?.columnId === c.id && current?.dir === "desc" ? <Pill size="sm">Current</Pill> : null}
          onClick={() => onPick({ columnId: c.id, dir: "desc" })}
        />
      ))}
      {current && (
        <>
          <div className="menu__separator" />
          <MenuSectionLabel>Current</MenuSectionLabel>
          <MenuRow label="Clear sort" subtle onClick={() => onPick(null)} />
        </>
      )}
    </div>
  );
}

function OptionsPopover<T>({
  columns,
  hidden,
  onToggleColumn,
  onResetColumns,
  density,
  onDensity,
  savedViews,
  activeViewId,
  onApplyView,
  onSaveView,
  onDeleteView,
  anchorRef,
  onClose,
}: {
  columns: Column<T>[];
  hidden: Set<string>;
  onToggleColumn: (id: string) => void;
  onResetColumns: () => void;
  density: "compact" | "comfortable";
  onDensity: (d: "compact" | "comfortable") => void;
  savedViews?: SavedView[];
  activeViewId?: string | null;
  onApplyView?: (view: SavedView) => void;
  onSaveView?: (name: string) => void;
  onDeleteView?: (id: string) => void;
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const [newViewName, setNewViewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, anchorRef]);

  const rect = anchorRef.current?.getBoundingClientRect();
  const margin = 8;
  const style = rect
    ? {
        top: Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - 320 - margin)),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - 240 - margin)),
      }
    : { top: 48, left: 16 };

  const visibleCount = columns.length - hidden.size;
  const canHideMore = visibleCount > 1;

  return (
    <div className="popover" ref={ref} style={style}>
      {savedViews && (
        <>
          <MenuSectionLabel>Saved views</MenuSectionLabel>
          {savedViews.length === 0 && (
            <div className="empty-state empty-state--sm empty-state--start">
              No saved views yet.
            </div>
          )}
          {savedViews.map((view) => (
            <div key={view.id} className="options-popover__view-row">
              <button
                type="button"
                className={`options-popover__view-name${activeViewId === view.id ? " is-active" : ""}`}
                onClick={() => onApplyView?.(view)}
                title="Apply this view"
              >
                {view.name}
              </button>
              <button
                type="button"
                className="options-popover__view-del"
                onClick={() => onDeleteView?.(view.id)}
                aria-label={`Delete view ${view.name}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <div className="options-popover__save-row">
            <input
              className="options-popover__save-input"
              placeholder="Save current view as…"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newViewName.trim()) {
                  onSaveView?.(newViewName);
                  setNewViewName("");
                }
              }}
            />
            <button
              type="button"
              className="btn-action btn-action--primary"
              disabled={!newViewName.trim()}
              onClick={() => {
                onSaveView?.(newViewName);
                setNewViewName("");
              }}
            >
              Save
            </button>
          </div>
          <div className="menu__separator" />
        </>
      )}
      <MenuSectionLabel>Density</MenuSectionLabel>
      <div className="options-popover__segmented" role="radiogroup" aria-label="Density">
        <button
          type="button"
          role="radio"
          aria-checked={density === "compact"}
          className={`options-popover__seg${density === "compact" ? " is-active" : ""}`}
          onClick={() => onDensity("compact")}
        >
          Compact
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={density === "comfortable"}
          className={`options-popover__seg${density === "comfortable" ? " is-active" : ""}`}
          onClick={() => onDensity("comfortable")}
        >
          Comfortable
        </button>
      </div>
      <div className="menu__separator" />
      <MenuSectionLabel>Columns</MenuSectionLabel>
      {columns.map((col) => {
        const isHidden = hidden.has(col.id);
        const label = typeof col.header === "string" ? col.header : col.id;
        return (
          <label key={col.id} className="options-popover__col-row">
            <input
              type="checkbox"
              checked={!isHidden}
              onChange={() => {
                // Keep at least one column visible.
                if (!isHidden && !canHideMore) return;
                onToggleColumn(col.id);
              }}
              disabled={!isHidden && !canHideMore}
            />
            <span>{label}</span>
          </label>
        );
      })}
      {hidden.size > 0 && (
        <>
          <div className="menu__separator" />
          <MenuRow label="Reset columns" subtle onClick={onResetColumns} />
        </>
      )}
    </div>
  );
}
