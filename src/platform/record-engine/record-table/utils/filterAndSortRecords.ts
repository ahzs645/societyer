import type { RecordField, ViewFilter, ViewFilterGroup, ViewSort } from "../../types/View";
import type { DateRangeContext } from "../../../../lib/dateRanges";
import { filterRecords } from "./filterRecords";
import { sortRecords } from "./sortRecords";

export function filterAndSortRecords<T extends object>({
  records,
  columns,
  filters,
  filterGroups,
  sorts,
  searchTerm,
  dateContext,
}: {
  records: T[];
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  sorts: ViewSort[];
  searchTerm?: string;
  dateContext?: DateRangeContext;
}): T[] {
  return sortRecords({
    records: filterRecords({ records, columns, filters, filterGroups, searchTerm, dateContext }),
    columns,
    sorts,
  });
}
