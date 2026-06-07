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
import { mobileCardMediaQuery } from "../lib/breakpoints";
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
import { useDataTable, type DataTableProps } from "./useDataTable";
export type EditableCellConfig<T> = {
  type: "text" | "number" | "select" | "date" | "autocomplete";
  /** Current value (pre-edit). Defaults to the column accessor. */
  getValue?: (row: T) => string | number | null | undefined;
  /** For `select` and `autocomplete`, the option list. Can be static or per-row. */
  options?: string[] | ((row: T) => string[]);
  /** Commit callback — return a Promise to show loading state. Reject to show error. */
  onCommit: (row: T, value: string) => void | Promise<void>;
  /** For `autocomplete`: handler invoked when user clicks ✕ on a suggestion. */
  onRemoveOption?: (value: string) => void;
  /** Placeholder shown in the empty input. */
  placeholder?: string;
};


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
  /** Makes the cell click-to-edit via a portaled popover. */
  editable?: EditableCellConfig<T>;
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


export function DataTable<T extends { _id?: string } & Record<string, any>>(props: DataTableProps<T>) {
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
  } = useDataTable(props);
  return (
    <div className="table-wrap" style={{ position: "relative" }}>
      <ViewBar
        label={label}
        count={filtered.length}
        icon={icon}
        filterBtnRef={filterBtnRef}
        sortBtnRef={sortBtnRef}
        optionsBtnRef={optionsBtnRef}
        savedViews={viewsKey ? savedViews : undefined}
        sharedViews={sharedViewsEnabled}
        activeViewId={activeViewId}
        viewsKey={viewsKey}
        onApplyView={applyView}
        onSaveView={saveView}
        onDeleteView={deleteView}
        onTogglePinView={togglePin}
        onFilter={
          filterFields?.length
            ? () => {
                setFilterOpen((v) => !v);
                setSortOpen(false);
                setOptionsOpen(false);
              }
            : undefined
        }
        onAdvanced={
          filterFields?.length
            ? () => setAdvancedOpen(true)
            : undefined
        }
        advancedActive={!!advanced && advanced.rules.length > 0}
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
          anchorRef={optionsBtnRef as any}
          onClose={() => setOptionsOpen(false)}
        />
      )}
      {effectiveFilterFields && (
        <FilterChips
          filters={filters}
          fields={effectiveFilterFields}
          onRemove={(i) => setFilters(filters.filter((_, idx) => idx !== i))}
        />
      )}
      {filterOpen && effectiveFilterFields && (
        <FilterPopover
          fields={effectiveFilterFields}
          anchorRef={filterBtnRef as any}
          onAdd={(f) => setFilters([...filters, f])}
          onClose={() => setFilterOpen(false)}
        />
      )}
      {effectiveFilterFields && (
        <AdvancedFilterModal
          open={advancedOpen}
          onClose={() => setAdvancedOpen(false)}
          fields={effectiveFilterFields}
          initial={advanced}
          onApply={setAdvanced}
          onClear={() => { setAdvanced(null); setAdvancedOpen(false); }}
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
            const cardClick = onPrimaryCellClick ?? onRowClick;
            return (
              <div
                key={rowKey(row)}
                className={`card-list__item${cardClick ? " card-list__item--interactive" : ""}`}
                role="listitem"
                onClick={cardClick ? () => cardClick(row) : undefined}
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
      <TableScrollWrap stickyFirst={visibleColumns.length >= 6}>
      <table className={`table${density === "comfortable" ? " table--comfortable" : ""}${visibleColumns.length >= 6 ? " table--sticky-first" : ""}`}>
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
                  width: columnWidths[col.id] ?? col.width,
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
                <ColumnResizeHandle
                  columnId={col.id}
                  onResize={(width) => setColumnWidths((w) => ({ ...w, [col.id]: width }))}
                />
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
          {!loading && visibleRows.map((row, rowIndex) => {
            const id = rowKey(row);
            const isSelected = selectable && selected.has(id);
            return (
            <tr
              key={id}
              data-row-index={rowIndex}
              className={`${renderRowActions ? "table__row--actions " : ""}${isSelected ? "is-selected" : ""}`.trim() || undefined}
              onClick={onRowClick && rowClickScope === "row" ? () => onRowClick(row) : undefined}
              onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, row) : undefined}
              style={{ cursor: onRowClick && rowClickScope === "row" ? "pointer" : undefined }}
              aria-selected={selectable ? isSelected : undefined}
            >
              {selectable && (
                <td className="table__select-cell" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={isSelected ? `Deselect row` : `Select row`}
                    checked={isSelected}
                    onChange={(e) => toggleRow(row, e)}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        e.preventDefault();
                        toggleRow(row, e);
                      }
                    }}
                  />
                </td>
              )}
              {visibleColumns.map((col, index) => {
                const cell = col.render ? col.render(row) : String(col.accessor?.(row) ?? "");
                const isEditable = Boolean(col.editable);
                const isFocused = focusedCell?.row === rowIndex && focusedCell?.col === index;
                return (
                <td
                  key={col.id}
                  data-row-index={rowIndex}
                  data-col-index={index}
                  className={`${col.className ?? ""}${isFocused ? " is-focused" : ""}`.trim() || undefined}
                  style={{ textAlign: col.align }}
                  onClick={(e) => {
                    if (isEditable) {
                      setFocusedCell({ row: rowIndex, col: index });
                      e.stopPropagation();
                      return;
                    }
                    // For the first cell, the inner button stops propagation
                    // when hit directly. This branch only runs when the click
                    // landed on td padding around the button — treat that as
                    // the same action so it doesn't fall through to the row
                    // click (which usually opens an edit drawer). Skip the
                    // focus ring since we're about to navigate away.
                    if (index === 0 && (onPrimaryCellClick || onRowClick)) {
                      e.stopPropagation();
                      (onPrimaryCellClick ?? onRowClick)!(row);
                      return;
                    }
                    setFocusedCell({ row: rowIndex, col: index });
                  }}
                >
                  {isEditable ? (
                    <EditableCell row={row} column={col} display={cell} />
                  ) : (onPrimaryCellClick || onRowClick) && index === 0 ? (
                    <button
                      type="button"
                      className="table__cell-button"
                      aria-label={rowActionLabel?.(row) ?? `Open ${label} row`}
                      onClick={(event) => {
                        event.stopPropagation();
                        (onPrimaryCellClick ?? onRowClick)!(row);
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
          {!loading && filtered.length === 0 && (
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
      </TableScrollWrap>
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
