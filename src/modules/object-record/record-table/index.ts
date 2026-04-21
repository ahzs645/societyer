// Public surface of the RecordTable module. Pages should only import from
// this file (or `../types`) — never reach into internal components/hooks.

export { RecordTable } from "./components/RecordTable";
export { RecordTableScope } from "./components/RecordTableScope";
export { RecordTableToolbar } from "./components/RecordTableToolbar";
export { RecordTableFilterChips } from "./components/RecordTableFilterChips";
export { RecordTableFilterPopover } from "./components/RecordTableFilterPopover";
export { RecordTableBulkBar } from "./components/RecordTableBulkBar";
export type { BulkAction } from "./components/RecordTableBulkBar";
export { RecordTableEmpty } from "./components/RecordTableEmpty";

export { useObjectRecordTableData } from "./hooks/useHydratedView";
export { usePersistView } from "./hooks/usePersistView";

export {
  useRecordTableState,
  useRecordTableStoreHandle,
} from "./state/recordTableStore";

export { useRecordTableContextOrThrow } from "./contexts/RecordTableContext";
export { useRecordTableRowContextOrThrow } from "./contexts/RecordTableRowContext";
