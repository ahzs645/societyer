// Public surface of the RecordTable module. Pages should only import from
// this file (or `../types`) — never reach into internal components/hooks.

export { RecordTable } from "./components/RecordTable";
export type { RecordTableCellRenderer } from "./components/RecordTable";
export { RecordTableScope } from "./components/RecordTableScope";
export { RecordTableToolbar } from "./components/RecordTableToolbar";
export { RecordTableViewToolbar } from "./components/RecordTableViewToolbar";
export { RecordTableFilterChips } from "./components/RecordTableFilterChips";
export { RecordTableFilterPopover } from "./components/RecordTableFilterPopover";
export { RecordTableSortPopover } from "./components/RecordTableSortPopover";
export { RecordTableBulkBar } from "./components/RecordTableBulkBar";
export type { BulkAction } from "./components/RecordTableBulkBar";
export { RecordTableEmpty } from "./components/RecordTableEmpty";
export { ObjectRecordTable } from "./components/ObjectRecordTable";
export { RecordTablePhoneCard } from "./components/RecordTablePhoneCard";
export { RecordTablePager } from "./components/RecordTablePager";
export type { RecordTablePagination, RecordTableServerQuery } from "./contexts/RecordTableContext";
export { staticRecordTable } from "./utils/staticRecordTable";
export type { StaticFieldDefinition } from "./utils/staticRecordTable";
export type { RecordTableCardHelpers, RecordTableCardRecord, RecordTableCardRenderer } from "./components/RecordTableCardList";
export { recordPersonName, recordText, recordTitleText } from "./utils/recordTitle";

export { useObjectRecordTableData } from "./hooks/useHydratedView";
export { useFilteredRecords } from "./hooks/useFilteredRecords";
export { usePersistView } from "./hooks/usePersistView";

export {
  useRecordTableState,
  useRecordTableStoreHandle,
  useRecordTableIsDirty,
  computeIsDirty,
} from "./state/recordTableStore";

export { useRecordTableContextOrThrow } from "./contexts/RecordTableContext";
export { useRecordTableInlineEdit } from "./contexts/RecordTableInlineEditContext";
export type {
  RecordTableInlineEdit,
  RecordTableEditableColumn,
  RecordTableEditorKind,
  RecordTableCellEdit,
  InlineEditRecord,
} from "./contexts/RecordTableInlineEditContext";
export { RECORD_TABLE_GRID_SHORTCUTS } from "./utils/gridShortcuts";
export { useRecordTableRowContextOrThrow } from "./contexts/RecordTableRowContext";
