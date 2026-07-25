import { useMemo } from "react";
import { useRecordTableState } from "../state/recordTableStore";
import { filterAndSortRecords } from "../utils/filterAndSortRecords";

/**
 * Takes the records from the store plus the active view's filter/sort/search
 * state and returns a derived list. All in-memory — good enough for a few
 * thousand rows, which is where RecordTable's virtualization kicks in anyway.
 */
export function useFilteredRecords() {
  const records = useRecordTableState((s) => s.records);
  const columns = useRecordTableState((s) => s.columns);
  const filters = useRecordTableState((s) => s.filters);
  const filterGroups = useRecordTableState((s) => s.filterGroups);
  const sorts = useRecordTableState((s) => s.sorts);
  const searchTerm = useRecordTableState((s) => s.searchTerm);

  return useMemo(() => {
    return filterAndSortRecords({ records, columns, filters, filterGroups, sorts, searchTerm });
  }, [records, columns, filters, filterGroups, sorts, searchTerm]);
}
