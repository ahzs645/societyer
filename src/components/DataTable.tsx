import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
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
}: {
  label: string;
  icon?: ReactNode;
  data: T[];
  columns: Column<T>[];
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
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);

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
        onFilter={filterFields?.length ? () => setFilterOpen((v) => !v) : undefined}
        onSort={sortableColumns.length ? () => setSortOpen((v) => !v) : undefined}
      />
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
          {visibleRows.map((row) => {
            const primaryCol = columns[0];
            const secondaryCols = columns.slice(1);
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
        </div>
      ) : (
      <table className="table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
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
          {visibleRows.map((row) => (
            <tr
              key={rowKey(row)}
              className={renderRowActions ? "table__row--actions" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? "pointer" : undefined }}
            >
              {columns.map((col, index) => {
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
          ))}
          {filtered.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (renderRowActions ? 1 : 0)}
                className="table__empty"
              >
                {data.length === 0 ? emptyMessage : "No rows match the current filters."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
