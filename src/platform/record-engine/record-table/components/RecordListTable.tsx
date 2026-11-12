import { useState, type ReactNode } from "react";
import type { FieldMetadata } from "../../types";
import type { MenuSection } from "../../../../components/Menu";
import type { staticRecordTable } from "../utils/staticRecordTable";
import type { RecordTableCardHelpers } from "./RecordTableCardList";
import { RecordTable } from "./RecordTable";
import { RecordTableScope } from "./RecordTableScope";
import { RecordTableToolbar } from "./RecordTableToolbar";
import { RecordTableFilterPopover } from "./RecordTableFilterPopover";
import { RecordTableFilterChips } from "./RecordTableFilterChips";
import { RecordTableBulkBar, type BulkAction } from "./RecordTableBulkBar";

export type StaticRecordTableDefinition = ReturnType<typeof staticRecordTable>;

type RecordListTableProps<T extends { _id: string }> = {
  /** Columns and default view, from `staticRecordTable` (define it once, at module level). */
  table: StaticRecordTableDefinition;
  /** Unique to where the table is shown: it scopes column, sort and grouping choices. */
  tableId: string;
  /** Names the list in the toolbar and its search ("Search claims…"). */
  label: string;
  icon?: ReactNode;
  records: T[];
  loading?: boolean;
  /**
   * `page`: the page's main list, filling the viewport with column totals.
   * `card`: one of several lists on a page, inside a card whose heading
   * already names it; it keeps its natural height, shows no title or totals.
   */
  variant?: "page" | "card";
  /** Opens a row (its name cell, or the whole card on phones). */
  onOpen?: (record: T) => void;
  renderCell?: (cell: { record: T; field: FieldMetadata }) => ReactNode | undefined;
  /** Buttons beside each row (Approve, Resend…). */
  renderRowActions?: (record: T) => ReactNode;
  /** The row's "…" menu and right-click menu. No items: no menu. */
  rowMenuSections?: (record: T) => MenuSection[];
  renderPhoneCard?: (record: T, helpers: RecordTableCardHelpers) => ReactNode;
  emptyState?: ReactNode;
  /** Buttons at the end of the toolbar (New…, Import…). */
  toolbarActions?: ReactNode;
  /** Marks one row (the signed-in user, a linked record) without opening it. */
  highlightedRecordId?: string | null;
  /** Row checkboxes for bulk actions. */
  selectable?: boolean;
  /**
   * Actions over the checked rows, in the floating bar shown while any are
   * checked (Mark verified…). Giving any turns on `selectable`.
   */
  bulkActions?: BulkAction[];
  /** Column totals under the table (default: on for `page`, off for `card`). */
  showTotals?: boolean;
  /** The toolbar's title and count (default: on for `page`, off for `card`). */
  showTitle?: boolean;
  /**
   * Rendered inside the table's scope, after the table: a `RecordTableBulkBar`
   * for a `selectable` list, or small pieces that read the table's state with
   * `useRecordTableState` (whether it is searched, say).
   */
  children?: ReactNode;
};

/**
 * The standard list for records already in memory (a query's whole result)
 * whose columns are fixed in code: the shared toolbar, search, column menus,
 * filter chips, sort, grouping, density, keyboard navigation and phone cards,
 * set up the same way everywhere. Pages pass their rows and how to draw the
 * cells that need more than plain values; everything else comes from the
 * field types in `table`.
 *
 * Lists backed by stored object metadata use `ObjectRecordTable` instead.
 */
export function RecordListTable<T extends { _id: string }>({
  table,
  tableId,
  label,
  icon,
  records,
  loading = false,
  variant = "page",
  onOpen,
  renderCell,
  renderRowActions,
  rowMenuSections,
  renderPhoneCard,
  emptyState,
  toolbarActions,
  highlightedRecordId = null,
  selectable = false,
  bulkActions,
  showTotals,
  showTitle,
  children,
}: RecordListTableProps<T>) {
  const [filterOpen, setFilterOpen] = useState(false);
  const card = variant === "card";
  return (
    <div className={`record-list-table${card ? " record-list-table--card" : ""}`}>
      <RecordTableScope
        tableId={tableId}
        objectMetadata={table.objectMetadata}
        hydratedView={table.hydratedView}
        records={records}
        cellPreviews={false}
        highlightedRecordId={highlightedRecordId}
        onRecordClick={onOpen ? (_recordId, record) => onOpen(record as T) : undefined}
      >
        <RecordTableToolbar
          label={label}
          icon={icon}
          hideTitle={!(showTitle ?? !card)}
          actions={toolbarActions}
          onOpenFilter={() => setFilterOpen((open) => !open)}
        />
        <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
        <RecordTableFilterChips />
        <RecordTable
          fillViewport={!card}
          showAggregateFooter={showTotals ?? !card}
          // Rows defined in code have no record page to preview.
          previewAction={false}
          selectable={selectable || Boolean(bulkActions?.length)}
          loading={loading}
          emptyState={emptyState}
          renderCell={renderCell ? ({ record, field }) => renderCell({ record: record as T, field }) : undefined}
          renderRowActions={renderRowActions ? (record) => renderRowActions(record as T) : undefined}
          rowMenuSections={rowMenuSections ? (record) => rowMenuSections(record as T) : undefined}
          renderPhoneCard={renderPhoneCard ? (record, helpers) => renderPhoneCard(record as unknown as T, helpers) : undefined}
        />
        {bulkActions && bulkActions.length > 0 && <RecordTableBulkBar actions={bulkActions} />}
        {children}
      </RecordTableScope>
    </div>
  );
}
