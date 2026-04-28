import type { RecordField, ViewFilter, ViewFilterGroup, ViewSort } from "../../types/View";
import { filterRecords } from "./filterRecords";
import { sortRecords } from "./sortRecords";

export function filterAndSortRecords({
  records,
  columns,
  filters,
  filterGroups,
  sorts,
  searchTerm,
}: {
  records: any[];
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  sorts: ViewSort[];
  searchTerm?: string;
}) {
  return sortRecords({
    records: filterRecords({ records, columns, filters, filterGroups, searchTerm }),
    columns,
    sorts,
  });
}
