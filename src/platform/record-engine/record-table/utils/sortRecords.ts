import type { RecordField, ViewSort } from "../../types/View";
import { compareFieldValues, isEmptyValue } from "./filterRecords";

export function sortRecords({
  records,
  columns,
  sorts,
}: {
  records: any[];
  columns: RecordField[];
  sorts: ViewSort[];
}) {
  if (sorts.length === 0) return records;

  const fieldById = new Map(columns.map((column) => [column.fieldMetadataId, column]));
  const sortables = sorts
    .map((sort) => {
      const column = fieldById.get(sort.fieldMetadataId);
      return column ? { column, direction: sort.direction } : null;
    })
    .filter(
      (entry): entry is { column: RecordField; direction: ViewSort["direction"] } =>
        entry !== null,
    );

  if (sortables.length === 0) return records;

  return [...records].sort((a, b) => {
    for (const { column, direction } of sortables) {
      const av = a[column.field.name];
      const bv = b[column.field.name];

      if (isEmptyValue(av) || isEmptyValue(bv)) {
        if (isEmptyValue(av) && isEmptyValue(bv)) continue;
        return isEmptyValue(av)
          ? direction === "asc"
            ? -1
            : 1
          : direction === "asc"
            ? 1
            : -1;
      }

      const comparison = compareFieldValues(av, bv, column.field.fieldType);
      if (comparison !== 0) return direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}
