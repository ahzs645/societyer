import { useState, type ReactNode } from "react";
import {
  RecordTable,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTableScope,
  RecordTableToolbar,
  staticRecordTable,
  type RecordTableCardHelpers,
} from "@/platform/record-engine";
import type { FieldMetadata } from "@/platform/record-engine";
import type { MenuSection } from "../../../components/Menu";

export type StaticTable = ReturnType<typeof staticRecordTable>;

/**
 * A finance register drawn by the shared record table from rows already in
 * memory (a query's whole result): the same toolbar, search, column menus,
 * filters, density, keyboard navigation and phone cards as the metadata-driven
 * registers, for lists whose columns are fixed in code (`staticRecordTable`).
 * Several can sit on one page, so each keeps its natural height rather than
 * filling the viewport.
 */
export function RegisterTable<T extends { _id: string }>({
  table,
  tableId,
  label,
  icon,
  records,
  loading = false,
  onOpen,
  renderCell,
  renderRowActions,
  rowMenuSections,
  renderPhoneCard,
  emptyState,
  toolbarActions,
}: {
  table: StaticTable;
  /** Unique to the place the table is shown (scopes its column and grouping choices). */
  tableId: string;
  label: string;
  icon?: ReactNode;
  records: T[];
  loading?: boolean;
  /** Opens a row (its name cell, or the whole card on phones). */
  onOpen?: (record: T) => void;
  renderCell?: (cell: { record: T; field: FieldMetadata }) => ReactNode | undefined;
  renderRowActions?: (record: T) => ReactNode;
  rowMenuSections?: (record: T) => MenuSection[];
  renderPhoneCard?: (record: T, helpers: RecordTableCardHelpers) => ReactNode;
  emptyState?: ReactNode;
  toolbarActions?: ReactNode;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  return (
    <RecordTableScope
      tableId={tableId}
      objectMetadata={table.objectMetadata}
      hydratedView={table.hydratedView}
      records={records}
      cellPreviews={false}
      onRecordClick={onOpen ? (_recordId, record) => onOpen(record) : undefined}
    >
      <RecordTableToolbar
        label={label}
        icon={icon}
        actions={toolbarActions}
        onOpenFilter={() => setFilterOpen((open) => !open)}
      />
      <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
      <RecordTableFilterChips />
      <RecordTable
        fillViewport={false}
        loading={loading}
        emptyState={emptyState}
        renderCell={renderCell ? ({ record, field }) => renderCell({ record, field }) : undefined}
        renderRowActions={renderRowActions}
        rowMenuSections={rowMenuSections}
        renderPhoneCard={
          renderPhoneCard ? (record, helpers) => renderPhoneCard(record as unknown as T, helpers) : undefined
        }
      />
    </RecordTableScope>
  );
}
