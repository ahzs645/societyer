import { FIELD_TYPES, type FieldMetadata } from "../../types";
import { isDateFieldType, isNumericFieldType } from "./filterValues";

/**
 * Sort direction wording by what the column holds: "A → Z" for text,
 * "1 → 9" for numbers, oldest/newest for dates. Options sort by label unless
 * the field keeps its listed order (sortRecords' `sortByOptionOrder`).
 */
export function sortDirectionLabels(field: FieldMetadata | undefined): { asc: string; desc: string } {
  if (!field) return { asc: "Ascending", desc: "Descending" };
  if (isDateFieldType(field.fieldType)) return { asc: "Oldest first", desc: "Newest first" };
  if (isNumericFieldType(field.fieldType)) return { asc: "1 → 9", desc: "9 → 1" };
  if (field.fieldType === FIELD_TYPES.BOOLEAN) return { asc: "No first", desc: "Yes first" };
  if (field.fieldType === FIELD_TYPES.SELECT && field.config?.sortByOptionOrder === true) {
    return { asc: "Listed order", desc: "Reverse order" };
  }
  return { asc: "A → Z", desc: "Z → A" };
}
