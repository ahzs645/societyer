import type { GridColumn, GridColumnType, GridOption, GridRow, ParseResult } from "../../../../components/EditableGrid/types";
import { cellText, isEmptyValue, parseCellText, valuesEqual } from "../../../../components/EditableGrid/values";
import type { FieldMetadata } from "../../types";
import type { InlineEditRecord, RecordTableEditableColumn, RecordTableEditorKind } from "../contexts/RecordTableInlineEditContext";

/*
 * Grid-mode value handling for RecordTable. Parsing and formatting are the
 * EditableGrid's (components/EditableGrid/values.ts): a declared column is
 * adapted to a GridColumn and its record to a GridRow, so typed and pasted
 * text coerce exactly as they do in the budget grid. Pure, no React.
 */

const GRID_TYPE: Record<RecordTableEditorKind, GridColumnType> = {
  text: "text",
  number: "number",
  currency: "money",
  date: "date",
  select: "select",
  relation: "select",
};

type MetadataOption = { value?: unknown; label?: unknown };

/** Choices for a select/relation column: its own, else the field's metadata options. */
export function inlineEditOptions(field: FieldMetadata, column: RecordTableEditableColumn, record: InlineEditRecord): GridOption[] {
  if (typeof column.options === "function") return column.options(record);
  if (column.options) return column.options;
  const metadata = (field.config?.options ?? []) as MetadataOption[];
  return Array.isArray(metadata)
    ? metadata
        .filter((option) => option && option.value != null)
        .map((option) => ({ value: String(option.value), label: String(option.label ?? option.value) }))
    : [];
}

/** Currency fields hold cents only when their metadata says so; the grid parses to cents. */
function storesCents(field: FieldMetadata) {
  return Boolean(field.config?.isCents);
}

export function toGridRow(record: InlineEditRecord): GridRow {
  return { ...record, key: String(record._id ?? "") };
}

/** The EditableGrid column a declared RecordTable column edits as. */
export function toGridColumn(field: FieldMetadata, column: RecordTableEditableColumn): GridColumn<GridRow> {
  return {
    key: field.name,
    header: field.label,
    type: GRID_TYPE[column.editor],
    placeholder: column.placeholder,
    required: column.required,
    currency: typeof field.config?.currencyCode === "string" ? field.config.currencyCode : undefined,
    options: (row) => inlineEditOptions(field, column, row),
  };
}

/** Grid value (cents for money) → the value the record stores. */
function toStoredValue(value: unknown, field: FieldMetadata, column: RecordTableEditableColumn) {
  if (column.editor === "currency" && typeof value === "number" && !storesCents(field)) return value / 100;
  return value;
}

/** Stored value → grid value (cents for money). */
function toGridValue(value: unknown, field: FieldMetadata, column: RecordTableEditableColumn) {
  if (column.editor === "currency" && typeof value === "number" && !storesCents(field)) return Math.round(value * 100);
  return value;
}

export function emptyInlineValue(column: RecordTableEditableColumn) {
  if ("emptyValue" in column) return column.emptyValue;
  return column.editor === "number" || column.editor === "currency" ? null : "";
}

/** `required` and the column's own `validate` on a parsed value; null when it may be saved. */
export function validateInlineValue(
  value: unknown,
  field: FieldMetadata,
  column: RecordTableEditableColumn,
  record: InlineEditRecord,
): string | null {
  if (column.required && isEmptyValue(value)) return `${field.label} is required.`;
  return column.validate?.(value, record) ?? null;
}

/** Typed or pasted text → a stored value, or the reason it can't be one. */
export function parseInlineText(
  text: string,
  field: FieldMetadata,
  column: RecordTableEditableColumn,
  record: InlineEditRecord,
): ParseResult {
  const parsed = parseCellText(text, toGridColumn(field, column), toGridRow(record));
  if (!parsed.ok) return parsed;
  const value = isEmptyValue(parsed.value) ? emptyInlineValue(column) : toStoredValue(parsed.value, field, column);
  const error = validateInlineValue(value, field, column, record);
  return error ? { ok: false, error } : { ok: true, value };
}

/** A value picked in an editor (an option, a calendar day) → stored value or error. */
export function checkInlineValue(
  value: unknown,
  field: FieldMetadata,
  column: RecordTableEditableColumn,
  record: InlineEditRecord,
): ParseResult {
  const stored = isEmptyValue(value) ? emptyInlineValue(column) : value;
  const error = validateInlineValue(stored, field, column, record);
  return error ? { ok: false, error } : { ok: true, value: stored };
}

/**
 * Plain text for a cell: what an edit starts from and what copy puts on the
 * clipboard. It parses back to the same value ("1200.50", an ISO date, an
 * option's label).
 */
export function formatInlineText(
  value: unknown,
  field: FieldMetadata,
  column: RecordTableEditableColumn,
  record: InlineEditRecord,
): string {
  return cellText(toGridValue(value, field, column), toGridColumn(field, column), toGridRow(record));
}

/** Same value for saving purposes (blank == blank, 12 == 12). */
export function sameInlineValue(a: unknown, b: unknown) {
  if (valuesEqual(a, b)) return true;
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
