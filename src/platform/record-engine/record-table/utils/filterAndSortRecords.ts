import type { RecordField, ViewFilter, ViewFilterGroup, ViewSort } from "../../types/View";
import type { DateRangeContext } from "../../../../lib/dateRanges";
import { filterRecords } from "./filterRecords";
import { sortRecords } from "./sortRecords";

export function filterAndSortRecords({
  records,
  columns,
  filters,
  filterGroups,
  sorts,
  searchTerm,
  dateContext,
}: {
  records: any[];
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  sorts: ViewSort[];
  searchTerm?: string;
  dateContext?: DateRangeContext;
}) {
  return sortRecords({
    records: filterRecords({ records, columns, filters, filterGroups, searchTerm, dateContext }),
    columns,
    sorts,
  });
}
