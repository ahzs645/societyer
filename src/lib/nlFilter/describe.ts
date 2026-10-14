import { FIELD_TYPES, type ViewFilterOperator } from "../../platform/record-engine/types";
import { describeDateRange, formatCalendarDate, isDateRangeValue } from "../dateRanges";
import { DEFAULT_CURRENCY, formatMoney } from "../money";
import type { NlCondition, NlField, NlNode } from "./types";
import { isDateField, isNumericField } from "./fields";
import { quote } from "./text";

const SYMBOLS: Partial<Record<ViewFilterOperator, string>> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

/** A stored value in the field's own unit, read as a person would. */
export function describeValue(field: NlField, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((entry) => describeValue(field, entry)).join(" or ");
  if (isDateRangeValue(value)) return describeDateRange(value);
  if (field.type === FIELD_TYPES.CURRENCY) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return formatMoney(field.isCents ? number : Math.round(number * 100), {
      currency: field.currencyCode ?? DEFAULT_CURRENCY,
      trimWholeCents: true,
      negativeStyle: "minus",
    });
  }
  if (isNumericField(field)) return Number(value).toLocaleString("en-CA");
  if (isDateField(field) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatCalendarDate(value);
  if (field.options?.length) return field.options.find((option) => option.value === String(value))?.label ?? String(value);
  return quote(String(value));
}

/** Chip text for one condition: "Amount ≥ $1,500", "Status is Active", "Not archived". */
export function describeCondition(field: NlField, operator: ViewFilterOperator, value: unknown): string {
  const label = field.label;
  switch (operator) {
    case "isTrue":
      return field.trueLabel ?? label;
    case "isFalse":
      return field.falseLabel ?? `Not ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    case "isEmpty":
      return `No ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    case "isNotEmpty":
      return `Has ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    case "between":
      return `${label}: ${describeValue(field, value)}`;
    case "in":
      return `${label} is ${describeValue(field, value)}`;
    case "notIn":
    case "neq":
      return `${label} is not ${describeValue(field, value)}`;
    case "eq":
      return isNumericField(field) ? `${label} = ${describeValue(field, value)}` : `${label} is ${describeValue(field, value)}`;
    case "contains":
      return field.options?.length ? `${label} includes ${describeValue(field, value)}` : `${label} contains ${describeValue(field, value)}`;
    case "notContains":
      return `${label} doesn't contain ${describeValue(field, value)}`;
    case "startsWith":
      return `${label} starts with ${describeValue(field, value)}`;
    case "endsWith":
      return `${label} ends with ${describeValue(field, value)}`;
    default: {
      const symbol = SYMBOLS[operator];
      if (isDateField(field) && symbol) {
        const word = operator === "lt" ? "before" : operator === "gt" ? "after" : operator === "lte" ? "on or before" : "on or after";
        return `${label} ${word} ${describeValue(field, value)}`;
      }
      return `${label} ${symbol ?? operator} ${describeValue(field, value)}`;
    }
  }
}

export function makeCondition(field: NlField, operator: ViewFilterOperator, value: unknown, text?: string, detail?: string): NlCondition {
  return { fieldId: field.id, operator, value, text: text ?? describeCondition(field, operator, value), detail };
}

/** One chip line for a node: groups read "(A or B)". */
export function describeNode(node: NlNode): { text: string; detail?: string } {
  if (node.kind === "condition") return { text: node.condition.text, detail: node.condition.detail };
  const parts = node.children.map((child) => describeNode(child).text);
  const joined = parts.join(node.operator === "or" ? " or " : " and ");
  return { text: node.children.length > 1 ? `(${joined})` : joined };
}
