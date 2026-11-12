import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FieldMetadata, HydratedView } from "../../types";
import type { MenuSection } from "../../../../components/Menu";
import type { staticRecordTable } from "../utils/staticRecordTable";
import type { RecordTableCardHelpers } from "./RecordTableCardList";
import { RecordTable } from "./RecordTable";
import { RecordTableScope } from "./RecordTableScope";
import { RecordTableToolbar } from "./RecordTableToolbar";
import { RecordTableFilterPopover } from "./RecordTableFilterPopover";
import { RecordTableFilterChips } from "./RecordTableFilterChips";
import { RecordTableBulkBar, type BulkAction } from "./RecordTableBulkBar";
import { RecordListTableViews } from "./RecordListTableViews";
import { useRecordTableStoreHandle, type RecordTableState, type RecordTableStore } from "../state/recordTableStore";
import {
  LIST_TABLE_MEMORY_WRITE_DELAY_MS,
  carryListTableState,
  listTableMemoryKey,
  memorySlicesChanged,
  rememberListTable,
  restoreListTableMemory,
} from "../utils/listTableMemory";
import { listViewFieldsHash } from "../utils/listViewState";
import { useSociety } from "@/hooks/useSociety";
import { useCurrentUserId } from "@/hooks/useCurrentUser";

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
  /**
   * Opens a row (its name cell, or the whole card on phones), and a
   * `?record=<id>` deep link to one of these rows. Without it a deep link
   * shows the row in the generic preview panel.
   */
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
  /** Shown in that bar after the count, from the checked rows (their total, say). */
  bulkSummary?: (records: T[]) => ReactNode;
  /** Column totals under the table (default: on for `page`, off for `card`). */
  showTotals?: boolean;
  /** The toolbar's title and count (default: on for `page`, off for `card`). */
  showTitle?: boolean;
  /**
   * Remember the list's last columns (order, visibility, widths), sorts,
   * filters, grouping, display mode and density for the signed-in person in
   * this browser, and restore them on return (default: on). The key is the
   * workspace, the person and `tableId`.
   */
  rememberState?: boolean;
  /**
   * Named views shared with the workspace (`listViews`): a views menu with
   * the list's default view and the saved ones, Save / Save as, rename and
   * delete, and `?view=<id>` links (default: on for `page`, off for `card`).
   * Saving needs settings:write; everyone can choose a view.
   */
  savedViews?: boolean;
  /**
   * Rendered inside the table's scope, after the table: small pieces that
   * read the table's state with `useRecordTableState` (whether it is
   * searched, say). Bulk bars use `bulkActions` / `bulkSummary`.
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
 * Each list remembers its last state per person and browser (`rememberState`,
 * utils/listTableMemory.ts), and page lists offer named views shared with the
 * workspace (`savedViews`, RecordListTableViews.tsx).
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
  bulkSummary,
  showTotals,
  showTitle,
  rememberState = true,
  savedViews,
  children,
}: RecordListTableProps<T>) {
  const [filterOpen, setFilterOpen] = useState(false);
  const card = variant === "card";
  const society = useSociety() as { _id?: string } | null | undefined;
  const userId = useCurrentUserId();
  const societyId = society?._id ? String(society._id) : null;
  const fieldsHash = useMemo(() => listViewFieldsHash(table.objectMetadata), [table.objectMetadata]);
  const memoryKey = rememberState && societyId && userId ? listTableMemoryKey(societyId, String(userId), tableId) : null;
  const rememberedViewId = useRef<string | null>(null);
  // A new store starts from the remembered state; a redefined list (another
  // currency's columns) keeps what was on show.
  const initialize = (store: RecordTableStore, previous: RecordTableState | null) => {
    if (previous) carryListTableState(store, previous, table.hydratedView);
    else rememberedViewId.current = memoryKey ? restoreListTableMemory(store, memoryKey, fieldsHash, table.hydratedView) : null;
  };
  const toolbar = {
    label,
    icon,
    hideTitle: !(showTitle ?? !card),
    actions: toolbarActions,
    onOpenFilter: () => setFilterOpen((open) => !open),
  };
  return (
    <div className={`record-list-table${card ? " record-list-table--card" : ""}`}>
      <RecordTableScope
        // Once the workspace and person are known, start again from what was remembered for them.
        key={memoryKey ?? "unremembered"}
        tableId={tableId}
        objectMetadata={table.objectMetadata}
        hydratedView={table.hydratedView}
        records={records}
        cellPreviews={false}
        highlightedRecordId={highlightedRecordId}
        onRecordClick={onOpen ? (_recordId, record) => onOpen(record as T) : undefined}
        initialize={initialize}
      >
        {memoryKey && <RecordListTableMemory storageKey={memoryKey} fieldsHash={fieldsHash} base={table.hydratedView} />}
        {(savedViews ?? !card) && societyId ? (
          <RecordListTableViews
            societyId={societyId}
            tableId={tableId}
            base={table.hydratedView}
            rememberedViewId={rememberedViewId}
            toolbar={toolbar}
          />
        ) : (
          <RecordTableToolbar {...toolbar} />
        )}
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
        {bulkActions && bulkActions.length > 0 && (
          <RecordTableBulkBar
            actions={bulkActions}
            summary={bulkSummary ? (selected) => bulkSummary(selected as unknown as T[]) : undefined}
          />
        )}
        {children}
      </RecordTableScope>
    </div>
  );
}

/** Writes the list's state to the browser a moment after each change (and on leaving). */
function RecordListTableMemory({ storageKey, fieldsHash, base }: { storageKey: string; fieldsHash: string; base: HydratedView }) {
  const handle = useRecordTableStoreHandle();
  useEffect(() => {
    let timer: number | undefined;
    const write = () => {
      timer = undefined;
      rememberListTable(storageKey, fieldsHash, handle.get(), base);
    };
    const unsubscribe = handle.subscribe((state, previous) => {
      if (!memorySlicesChanged(state, previous)) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(write, LIST_TABLE_MEMORY_WRITE_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) {
        window.clearTimeout(timer);
        write();
      }
    };
  }, [handle, storageKey, fieldsHash, base]);
  return null;
}
