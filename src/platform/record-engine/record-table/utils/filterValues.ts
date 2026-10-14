import { FIELD_TYPES, type FieldType, type CurrencyFieldConfig } from "../../types/FieldType";
import type { FieldMetadata } from "../../types/FieldMetadata";
import type { ViewFilterOperator } from "../../types/View";
import { parseMoneyInput, formatMoney, DEFAULT_CURRENCY } from "../../../../lib/money";
import { describeDateRange, formatCalendarDate, isDateRangeValue } from "../../../../lib/dateRanges";
import { selectLabel } from "./recordCellText";

export const VALUELESS_OPERATORS: readonly ViewFilterOperator[] = ["isEmpty", "isNotEmpty", "isTrue", "isFalse"];

export function isNumericFieldType(fieldType: FieldType) {
  return fieldType === FIELD_TYPES.NUMBER || fieldType === FIELD_TYPES.CURRENCY || fieldType === FIELD_TYPES.RATING;
}

export function isDateFieldType(fieldType: FieldType) {
  return fieldType === FIELD_TYPES.DATE || fieldType === FIELD_TYPES.DATE_TIME;
}

/**
 * What people type into number and amount filters: "1.5k", "$2,000",
 * "(300)", "-12.50". Currency filters compare in the field's stored unit, so
 * an `isCents` field gets cents and a dollars field gets dollars.
 */
export function parseNumericFilterInput(field: FieldMetadata, raw: string | number | null | undefined): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const cents = parseMoneyInput(raw ?? "");
  if (cents === undefined) return undefined;
  if (field.fieldType === FIELD_TYPES.CURRENCY && (field.config as CurrencyFieldConfig | undefined)?.isCents) return cents;
  return cents / 100;
}

/** The editable text for a stored numeric filter value (dollars for currency). */
export function numericFilterInputText(field: FieldMetadata, value: unknown): string {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return "";
  if (field.fieldType === FIELD_TYPES.CURRENCY && (field.config as CurrencyFieldConfig | undefined)?.isCents) {
    return String(number / 100);
  }
  return String(number);
}

/** A stored filter value the way a person reads it in a chip. */
export function describeFilterValue(field: FieldMetadata | undefined, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isDateRangeValue(value)) return describeDateRange(value);
  if (Array.isArray(value)) return value.map((entry) => describeFilterValue(field, entry)).join(", ");
  if (!field) return humanizeToken(String(value));
  if (field.fieldType === FIELD_TYPES.CURRENCY) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    const config = field.config as CurrencyFieldConfig | undefined;
    return formatMoney(config?.isCents ? number : Math.round(number * 100), {
      currency: config?.currencyCode ?? DEFAULT_CURRENCY,
      trimWholeCents: true,
    });
  }
  if (isNumericFieldType(field.fieldType)) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("en-CA") : String(value);
  }
  if (isDateFieldType(field.fieldType) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatCalendarDate(value);
  }
  if (field.fieldType === FIELD_TYPES.SELECT || field.fieldType === FIELD_TYPES.MULTI_SELECT || Array.isArray(field.config?.options)) {
    const label = selectLabel(field, value);
    return label === String(value) ? humanizeToken(label) : label;
  }
  if (field.fieldType === FIELD_TYPES.BOOLEAN) {
    return value === true || value === "true" ? field.config?.trueLabel ?? "Yes" : field.config?.falseLabel ?? "No";
  }
  return humanizeToken(String(value));
}

/** "previous-minutes" / "NeedsReview" / "needs_review" → "Previous minutes" / "Needs review". Free text is left alone. */
export function humanizeToken(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || /^\d+$/.test(value)) return value;
  if (!/[-_]|[a-z][A-Z]/.test(value)) return value;
  const words = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
