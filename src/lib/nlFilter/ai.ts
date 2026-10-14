import { FIELD_TYPES, type ViewFilterOperator } from "../../platform/record-engine/types";
import { operatorsForField } from "../../platform/record-engine/record-table/utils/filterLabels";
import { DATE_RANGE_PRESETS, isDateRangeValue, type DateRangeValue } from "../dateRanges";
import type { NlContext, NlField, NlNode, NlParseResult } from "./types";
import { isDateField, isNumericField } from "./fields";
import { describeNode, makeCondition } from "./describe";
import { conditionNode } from "./extractShared";
import { toFilterTree } from "./parse";

/**
 * Optional AI path for requests the offline parser can't place. The model sees
 * ONLY the column schema, today's date and the request — never row data — and
 * must answer with a JSON filter tree that is validated against the schema
 * before anything is shown.
 */

const VALUELESS: ViewFilterOperator[] = ["isEmpty", "isNotEmpty", "isTrue", "isFalse"];

function allowedOperators(field: NlField): ViewFilterOperator[] {
  const base = operatorsForField(field.type);
  const extra: ViewFilterOperator[] = field.type === FIELD_TYPES.RELATION ? ["contains"] : field.type === FIELD_TYPES.TEXT ? ["notContains"] : [];
  return [...new Set([...base, ...extra])];
}

export function aiFilterSchema(fields: NlField[]) {
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    operators: allowedOperators(field),
    ...(field.options?.length ? { options: field.options.map((option) => ({ value: option.value, label: option.label })) } : {}),
    ...(field.type === FIELD_TYPES.CURRENCY ? { unit: "dollars" } : {}),
  }));
}

export function buildAiFilterPrompt(fields: NlField[], query: string, context: NlContext) {
  const system = [
    "You turn a person's request into a filter for one table. Reply with a single JSON object and nothing else.",
    'Shape: {"operator":"and"|"or","conditions":[{"field":"<field id>","operator":"<operator>","value":<value>}],"groups":[{"operator":"and"|"or","conditions":[...]}],"unmatched":["words you could not use"]}.',
    "Use only the listed field ids and each field's listed operators. Select values must be one of the field's option values.",
    'Date fields with "between" take {"start":"YYYY-MM-DD","end":"YYYY-MM-DD"} (either may be omitted) or {"preset":"<preset id>"}. Other date operators take "YYYY-MM-DD".',
    'Currency values are plain numbers in dollars; "1.5k" is 1500. Signed amounts: money out is negative.',
    "isEmpty, isNotEmpty, isTrue and isFalse take null. in and notIn take an array.",
    "If part of the request cannot be expressed with these fields, leave it out and list its words in unmatched. Never invent fields.",
  ].join("\n");
  const user = JSON.stringify({
    today: context.today,
    fiscalYearEnd: context.fiscalYearEnd ?? null,
    datePresets: DATE_RANGE_PRESETS.map((preset) => preset.id),
    fields: aiFilterSchema(fields),
    request: query,
  });
  return { system, user };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function validValue(field: NlField, operator: ViewFilterOperator, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (VALUELESS.includes(operator)) return { ok: true, value: null };
  if (operator === "between") {
    if (!isDateField(field) || !isDateRangeValue(value)) return { ok: false };
    const range = value as DateRangeValue;
    if (range.preset && range.preset !== "custom") {
      return DATE_RANGE_PRESETS.some((preset) => preset.id === range.preset) ? { ok: true, value: { preset: range.preset } } : { ok: false };
    }
    if ((range.start && !DATE_ONLY.test(range.start)) || (range.end && !DATE_ONLY.test(range.end)) || (!range.start && !range.end)) return { ok: false };
    return { ok: true, value: { ...(range.start ? { start: range.start } : {}), ...(range.end ? { end: range.end } : {}) } };
  }
  if (operator === "in" || operator === "notIn") {
    if (!Array.isArray(value) || value.length === 0) return { ok: false };
    const values = value.map(String);
    if (field.options?.length && !values.every((entry) => field.options!.some((option) => option.value === entry))) return { ok: false };
    return { ok: true, value: values };
  }
  if (isNumericField(field)) {
    const number = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(number)) return { ok: false };
    return { ok: true, value: field.type === FIELD_TYPES.CURRENCY && field.isCents ? Math.round(number * 100) : number };
  }
  if (isDateField(field)) return typeof value === "string" && DATE_ONLY.test(value) ? { ok: true, value } : { ok: false };
  if (field.options?.length) {
    const text = String(value ?? "");
    const option = field.options.find((entry) => entry.value === text) ?? field.options.find((entry) => entry.label.toLowerCase() === text.toLowerCase());
    return option ? { ok: true, value: option.value } : { ok: false };
  }
  if (typeof value !== "string" || !value.trim() || value.length > 200) return { ok: false };
  return { ok: true, value: value.trim() };
}

/** Strictly validate a model's JSON reply against the schema. Unknown fields or operators reject the condition. */
export function validateAiFilterReply(raw: unknown, fields: NlField[], query: string): NlParseResult {
  const empty: NlParseResult = { status: "none", query, root: null, filters: [], filterGroups: [], chips: [], ignored: [], notes: [], suggestions: [], source: "ai" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...empty, notes: ["The AI reply wasn't a filter."] };
  const reply = raw as Record<string, unknown>;
  const rejected: string[] = [];
  const toNodes = (list: unknown): NlNode[] => {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).flatMap((entry): NlNode[] => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const field = fields.find((candidate) => candidate.id === item.field);
      const operator = item.operator as ViewFilterOperator;
      if (!field || !allowedOperators(field).includes(operator)) {
        rejected.push(String(item.field ?? "?"));
        return [];
      }
      const checked = validValue(field, operator, item.value);
      if (!checked.ok) {
        rejected.push(field.label);
        return [];
      }
      return [conditionNode(makeCondition(field, operator, checked.value))];
    });
  };
  const children = toNodes(reply.conditions);
  if (Array.isArray(reply.groups)) {
    for (const group of reply.groups.slice(0, 4)) {
      if (!group || typeof group !== "object") continue;
      const entry = group as Record<string, unknown>;
      const nodes = toNodes(entry.conditions);
      if (nodes.length === 1) children.push(nodes[0]);
      else if (nodes.length > 1) children.push({ kind: "group", operator: entry.operator === "or" ? "or" : "and", children: nodes });
    }
  }
  const unmatched = Array.isArray(reply.unmatched) ? reply.unmatched.filter((word): word is string => typeof word === "string").slice(0, 12) : [];
  const notes = rejected.length ? [`Left out ${rejected.length} suggested condition${rejected.length === 1 ? "" : "s"} that didn't fit this table.`] : [];
  if (children.length === 0) return { ...empty, ignored: unmatched, notes };
  const root = { operator: reply.operator === "or" ? ("or" as const) : ("and" as const), children };
  const tree = toFilterTree(root);
  return {
    ...empty,
    status: unmatched.length || rejected.length ? "partial" : "ok",
    root,
    ...tree,
    chips: children.map(describeNode),
    ignored: unmatched,
    notes,
  };
}

/** Pull the first JSON object out of a model reply (tolerates code fences). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
