import { FIELD_TYPES, type FieldType } from "../../types/FieldType";
import type { RecordField, ViewFilter, ViewFilterOperator } from "../../types/View";
import { describeFilterValue, isDateFieldType } from "./filterValues";

/** Operators offered per field type, most useful first. */
export const OPERATORS_BY_FIELD_TYPE: Partial<Record<FieldType, ViewFilterOperator[]>> = {
  [FIELD_TYPES.TEXT]: ["contains", "eq", "neq", "startsWith", "endsWith", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.EMAIL]: ["contains", "eq", "neq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.PHONE]: ["contains", "eq", "neq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.LINK]: ["contains", "eq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.NUMBER]: ["eq", "neq", "gt", "gte", "lt", "lte", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.CURRENCY]: ["gte", "lte", "gt", "lt", "eq", "neq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.RATING]: ["eq", "gt", "lt", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.BOOLEAN]: ["isTrue", "isFalse"],
  [FIELD_TYPES.DATE]: ["between", "eq", "neq", "gt", "lt", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.DATE_TIME]: ["between", "eq", "gt", "lt", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.SELECT]: ["eq", "neq", "in", "notIn", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.MULTI_SELECT]: ["contains", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.RELATION]: ["eq", "neq", "in", "notIn", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.UUID]: ["eq", "neq"],
  [FIELD_TYPES.ARRAY]: ["contains", "isEmpty", "isNotEmpty"],
};

export function operatorsForField(fieldType: FieldType | undefined): ViewFilterOperator[] {
  return (fieldType && OPERATORS_BY_FIELD_TYPE[fieldType]) ?? ["contains", "eq", "neq", "isEmpty", "isNotEmpty"];
}

const OPERATOR_LABELS: Record<ViewFilterOperator, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  notContains: "doesn't contain",
  startsWith: "starts with",
  endsWith: "ends with",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  in: "is any of",
  notIn: "is none of",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  isTrue: "is true",
  isFalse: "is false",
  between: "is within",
};

/** Operator wording for a field: dates read "is before / after", others "greater than". */
export function operatorLabel(operator: ViewFilterOperator, fieldType?: FieldType): string {
  if (fieldType && isDateFieldType(fieldType)) {
    if (operator === "gt") return "is after";
    if (operator === "lt") return "is before";
    if (operator === "gte") return "is on or after";
    if (operator === "lte") return "is on or before";
  }
  return OPERATOR_LABELS[operator] ?? operator;
}

/** "Status is Active", "Joined is within Last 30 days", "Amount at least $1.5K". */
export function describeFilter(filter: ViewFilter, column: RecordField | undefined): string {
  const field = column?.field.label ?? "Unknown field";
  const fieldType = column?.field.fieldType;
  if (filter.operator === "isTrue") return field;
  if (filter.operator === "isFalse") return `Not ${field.charAt(0).toLowerCase()}${field.slice(1)}`;
  if (filter.operator === "isEmpty" || filter.operator === "isNotEmpty") return `${field} ${operatorLabel(filter.operator)}`;
  if (filter.operator === "in" || filter.operator === "notIn") {
    const values = (Array.isArray(filter.value) ? filter.value : [filter.value]).map((value) => describeFilterValue(column?.field, value));
    return `${field} ${filter.operator === "in" ? "is" : "is not"} ${values.join(" or ")}`;
  }
  return `${field} ${operatorLabel(filter.operator, fieldType)} ${describeFilterValue(column?.field, filter.value)}`;
}
