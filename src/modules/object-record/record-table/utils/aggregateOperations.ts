import { FIELD_TYPES, type FieldType } from "../../types/FieldType";
import type { AggregateOperation, RecordField } from "../../types/View";
import { isEmptyValue } from "./filterRecords";

const NUMERIC_OPERATIONS: AggregateOperation[] = ["sum", "avg", "min", "max"];
const DATE_OPERATIONS: AggregateOperation[] = ["min", "max"];
const STANDARD_OPERATIONS: AggregateOperation[] = [
  "count",
  "countEmpty",
  "countNotEmpty",
  "countUniqueValues",
  "percentageEmpty",
  "percentageNotEmpty",
];

export function getAvailableAggregateOperationsForFieldType(
  fieldType?: FieldType,
): AggregateOperation[] {
  if (fieldType === FIELD_TYPES.RELATION) return ["count", "countEmpty", "countNotEmpty"];
  if (!fieldType) return STANDARD_OPERATIONS;
  if (isNumericFieldType(fieldType)) return [...STANDARD_OPERATIONS, ...NUMERIC_OPERATIONS];
  if (fieldType === FIELD_TYPES.DATE || fieldType === FIELD_TYPES.DATE_TIME) {
    return [...STANDARD_OPERATIONS, ...DATE_OPERATIONS];
  }
  return STANDARD_OPERATIONS;
}

export function isAggregateOperationValidForFieldType({
  operation,
  fieldType,
}: {
  operation?: AggregateOperation | null;
  fieldType?: FieldType;
}) {
  if (!operation) return true;
  return getAvailableAggregateOperationsForFieldType(fieldType).includes(operation);
}

export function defaultAggregateOperation(column: RecordField): AggregateOperation | null {
  if (isNumericFieldType(column.field.fieldType)) return "sum";
  if (
    column.field.fieldType === FIELD_TYPES.SELECT ||
    column.field.fieldType === FIELD_TYPES.MULTI_SELECT
  ) {
    return "countUniqueValues";
  }
  return null;
}

export function aggregateRecordValues({
  column,
  records,
  operation = column.aggregateOperation ?? defaultAggregateOperation(column),
}: {
  column: RecordField;
  records: any[];
  operation?: AggregateOperation | null;
}) {
  if (!operation || !isAggregateOperationValidForFieldType({ operation, fieldType: column.field.fieldType })) {
    return "";
  }

  const rawValues = records.map((record) => record[column.field.name]);
  const filledValues = rawValues.filter((value) => !isEmptyValue(value));

  if (operation === "count") return `${records.length} total`;
  if (operation === "countEmpty") return `${rawValues.length - filledValues.length} empty`;
  if (operation === "countNotEmpty") return `${filledValues.length} filled`;
  if (operation === "percentageEmpty") return formatPercent(rawValues.length - filledValues.length, rawValues.length);
  if (operation === "percentageNotEmpty") return formatPercent(filledValues.length, rawValues.length);
  if (operation === "countUniqueValues") return `${uniqueValueCount(filledValues)} unique`;

  if (column.field.fieldType === FIELD_TYPES.DATE || column.field.fieldType === FIELD_TYPES.DATE_TIME) {
    const times = filledValues.map((value) => Date.parse(String(value))).filter(Number.isFinite);
    if (times.length === 0) return "";
    const time = operation === "min" ? Math.min(...times) : operation === "max" ? Math.max(...times) : null;
    return time ? `${operation === "min" ? "Earliest" : "Latest"} ${new Date(time).toLocaleDateString()}` : "";
  }

  const numbers = filledValues.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return "";
  if (operation === "sum") return `Sum ${formatNumber(numbers.reduce((sum, value) => sum + value, 0))}`;
  if (operation === "avg") return `Avg ${formatNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length)}`;
  if (operation === "min") return `Min ${formatNumber(Math.min(...numbers))}`;
  if (operation === "max") return `Max ${formatNumber(Math.max(...numbers))}`;
  return "";
}

function isNumericFieldType(fieldType: FieldType) {
  return (
    fieldType === FIELD_TYPES.NUMBER ||
    fieldType === FIELD_TYPES.CURRENCY ||
    fieldType === FIELD_TYPES.RATING
  );
}

function uniqueValueCount(values: unknown[]) {
  return new Set(values.flatMap((value) => (Array.isArray(value) ? value : [value])).map(String)).size;
}

function formatPercent(part: number, total: number) {
  if (total === 0) return "0%";
  return `${formatNumber((part / total) * 100)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
