/**
 * Schema-only AI filter suggestions for record tables, shared by the server
 * action (workspace AI provider, convex/aiFilterActions.ts) and the browser
 * (device-local key in the local/desktop runtime).
 *
 * The model sees ONLY the column schema (ids, labels, types, operators, option
 * values), today's organisation-local date, the fiscal year end and the
 * request — never row data or workspace context. Its reply must be a JSON
 * filter tree, which `validateAiFilterJson` checks strictly against the same
 * schema: unknown fields, operators the field does not allow, and values that
 * do not fit are dropped and counted, never applied.
 */

export const AI_FILTER_OPERATORS = [
  "eq", "neq", "contains", "notContains", "startsWith", "endsWith",
  "gt", "gte", "lt", "lte", "in", "notIn",
  "isEmpty", "isNotEmpty", "isTrue", "isFalse", "between",
] as const;
export type AiFilterOperator = (typeof AI_FILTER_OPERATORS)[number];

/** Relative date presets a "between" value may name (mirrors src/lib/dateRanges.ts DATE_RANGE_PRESETS). */
export const AI_FILTER_DATE_PRESETS = [
  "today", "last7", "last30", "last90", "thisMonth", "lastMonth",
  "quarterToDate", "yearToDate", "fiscalYearToDate", "lastFiscalYear", "allTime",
] as const;

export const AI_FILTER_LIMITS = {
  /** Characters in the person's request. */
  query: 300,
  fields: 80,
  optionsPerField: 100,
  /** Characters in a field id, label or option value/label. */
  text: 120,
  conditions: 12,
  groups: 4,
  unmatched: 12,
  /** Characters in a free-text condition value. */
  value: 200,
} as const;

const VALUELESS: readonly AiFilterOperator[] = ["isEmpty", "isNotEmpty", "isTrue", "isFalse"];
const DATE_TYPES = new Set(["DATE", "DATE_TIME"]);
const NUMERIC_TYPES = new Set(["CURRENCY", "NUMBER", "RATING"]);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type AiFilterOption = { value: string; label: string };

/** One column as the AI path sees it. No row data, ever. */
export type AiFilterFieldSchema = {
  id: string;
  label: string;
  /** RecordTable field type tag (TEXT, CURRENCY, DATE…). */
  type: string;
  operators: AiFilterOperator[];
  options?: AiFilterOption[];
  /** Currency stored in cents: the model answers in dollars, the validator converts. */
  isCents?: boolean;
};

export type AiFilterContext = {
  /** Organisation-local today, `YYYY-MM-DD`. */
  today: string;
  fiscalYearEnd?: string | null;
};

export type AiFilterCondition = { field: string; operator: AiFilterOperator; value: unknown };
export type AiFilterGroup = { operator: "and" | "or"; conditions: AiFilterCondition[] };
export type AiFilterTree = { operator: "and" | "or"; conditions: AiFilterCondition[]; groups: AiFilterGroup[] };

export type AiFilterValidation = {
  /** Null when nothing in the reply fit the schema. */
  filter: AiFilterTree | null;
  /** Words the model said it could not use. */
  unmatched: string[];
  /** Suggested conditions dropped because they did not fit the schema. */
  droppedCount: number;
  notes: string[];
};

function isOperator(value: unknown): value is AiFilterOperator {
  return typeof value === "string" && (AI_FILTER_OPERATORS as readonly string[]).includes(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= AI_FILTER_LIMITS.text ? text : null;
}

/**
 * Normalise a caller-supplied schema: drop malformed or oversized entries, keep
 * only known operators, cap list sizes. Used by the server before it trusts
 * anything the browser sent; harmless (idempotent) on a well-formed schema.
 */
export function sanitizeAiFilterSchema(raw: unknown): AiFilterFieldSchema[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const fields: AiFilterFieldSchema[] = [];
  for (const entry of raw) {
    if (fields.length >= AI_FILTER_LIMITS.fields) break;
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const id = cleanText(item.id);
    const label = cleanText(item.label);
    const type = typeof item.type === "string" && /^[A-Z_]{2,24}$/.test(item.type) ? item.type : null;
    if (!id || !label || !type || seen.has(id)) continue;
    const operators = Array.isArray(item.operators) ? [...new Set(item.operators.filter(isOperator))] : [];
    if (!operators.length) continue;
    const options = Array.isArray(item.options)
      ? item.options
          .slice(0, AI_FILTER_LIMITS.optionsPerField)
          .flatMap((option): AiFilterOption[] => {
            if (!option || typeof option !== "object") return [];
            const value = cleanText((option as Record<string, unknown>).value);
            const optionLabel = cleanText((option as Record<string, unknown>).label);
            return value && optionLabel ? [{ value, label: optionLabel }] : [];
          })
      : [];
    seen.add(id);
    fields.push({
      id,
      label,
      type,
      operators,
      ...(options.length ? { options } : {}),
      ...(type === "CURRENCY" && item.isCents === true ? { isCents: true } : {}),
    });
  }
  return fields;
}

/** The system and user messages: strict JSON over the schema, nothing else. */
export function buildAiFilterPrompt(schema: AiFilterFieldSchema[], query: string, context: AiFilterContext) {
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
    datePresets: AI_FILTER_DATE_PRESETS,
    fields: schema.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      operators: field.operators,
      ...(field.options?.length ? { options: field.options } : {}),
      ...(field.type === "CURRENCY" ? { unit: "dollars" } : {}),
    })),
    request: query,
  });
  return { system, user };
}

type Checked = { ok: true; value: unknown } | { ok: false };

function checkValue(field: AiFilterFieldSchema, operator: AiFilterOperator, value: unknown): Checked {
  if (VALUELESS.includes(operator)) return { ok: true, value: null };
  const isDate = DATE_TYPES.has(field.type);
  if (operator === "between") {
    if (!isDate || !value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
    const range = value as Record<string, unknown>;
    if (range.preset !== undefined && range.preset !== "custom") {
      return (AI_FILTER_DATE_PRESETS as readonly unknown[]).includes(range.preset) ? { ok: true, value: { preset: range.preset } } : { ok: false };
    }
    const start = range.start ?? undefined;
    const end = range.end ?? undefined;
    if ((start !== undefined && (typeof start !== "string" || !DATE_ONLY.test(start))) || (end !== undefined && (typeof end !== "string" || !DATE_ONLY.test(end))) || (!start && !end)) return { ok: false };
    return { ok: true, value: { ...(start ? { start } : {}), ...(end ? { end } : {}) } };
  }
  if (operator === "in" || operator === "notIn") {
    if (!Array.isArray(value) || value.length === 0 || value.length > AI_FILTER_LIMITS.optionsPerField) return { ok: false };
    if (!value.every((entry) => typeof entry === "string" || typeof entry === "number")) return { ok: false };
    const values = value.map(String);
    if (field.options?.length && !values.every((entry) => field.options!.some((option) => option.value === entry))) return { ok: false };
    if (values.some((entry) => !entry.trim() || entry.length > AI_FILTER_LIMITS.value)) return { ok: false };
    return { ok: true, value: values };
  }
  if (NUMERIC_TYPES.has(field.type)) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number.NaN;
    if (!Number.isFinite(number)) return { ok: false };
    return { ok: true, value: field.type === "CURRENCY" && field.isCents ? Math.round(number * 100) : number };
  }
  if (isDate) return typeof value === "string" && DATE_ONLY.test(value) ? { ok: true, value } : { ok: false };
  if (field.options?.length) {
    if (typeof value !== "string" && typeof value !== "number") return { ok: false };
    const text = String(value);
    const option = field.options.find((entry) => entry.value === text) ?? field.options.find((entry) => entry.label.toLowerCase() === text.toLowerCase());
    return option ? { ok: true, value: option.value } : { ok: false };
  }
  if (typeof value !== "string" || !value.trim() || value.length > AI_FILTER_LIMITS.value) return { ok: false };
  return { ok: true, value: value.trim() };
}

/**
 * Strictly validate a model's parsed JSON reply against the schema. Conditions
 * naming an unknown field, an operator the field does not list, or a value that
 * does not fit are dropped and counted; currency in cents is converted from
 * dollars. The result only ever references fields in `schema`.
 */
export function validateAiFilterJson(raw: unknown, schema: AiFilterFieldSchema[]): AiFilterValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { filter: null, unmatched: [], droppedCount: 0, notes: ["The AI reply wasn't a filter."] };
  }
  const reply = raw as Record<string, unknown>;
  let droppedCount = 0;
  const byId = new Map(schema.map((field) => [field.id, field]));
  const toConditions = (list: unknown): AiFilterCondition[] => {
    if (!Array.isArray(list)) return [];
    if (list.length > AI_FILTER_LIMITS.conditions) droppedCount += list.length - AI_FILTER_LIMITS.conditions;
    return list.slice(0, AI_FILTER_LIMITS.conditions).flatMap((entry): AiFilterCondition[] => {
      const item = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
      const field = item && typeof item.field === "string" ? byId.get(item.field) : undefined;
      const operator = item?.operator;
      if (!item || !field || !isOperator(operator) || !field.operators.includes(operator)) {
        droppedCount++;
        return [];
      }
      const checked = checkValue(field, operator, item.value);
      if (!checked.ok) {
        droppedCount++;
        return [];
      }
      return [{ field: field.id, operator, value: checked.value }];
    });
  };
  const conditions = toConditions(reply.conditions);
  const groups: AiFilterGroup[] = [];
  if (Array.isArray(reply.groups)) {
    for (const group of reply.groups.slice(0, AI_FILTER_LIMITS.groups)) {
      if (!group || typeof group !== "object" || Array.isArray(group)) continue;
      const entry = group as Record<string, unknown>;
      const nodes = toConditions(entry.conditions);
      if (nodes.length === 1) conditions.push(nodes[0]);
      else if (nodes.length > 1) groups.push({ operator: entry.operator === "or" ? "or" : "and", conditions: nodes });
    }
  }
  const unmatched = Array.isArray(reply.unmatched)
    ? reply.unmatched
        .filter((word): word is string => typeof word === "string" && word.trim().length > 0)
        .map((word) => word.trim().slice(0, 60))
        .slice(0, AI_FILTER_LIMITS.unmatched)
    : [];
  const notes = droppedCount ? [`Left out ${droppedCount} suggested condition${droppedCount === 1 ? "" : "s"} that didn't fit this table.`] : [];
  if (!conditions.length && !groups.length) return { filter: null, unmatched, droppedCount, notes };
  return {
    filter: { operator: reply.operator === "or" ? "or" : "and", conditions, groups },
    unmatched,
    droppedCount,
    notes,
  };
}

/** Pull the first JSON object out of a model reply (tolerates code fences and prose). */
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

/** Typed failures the server action returns instead of throwing. */
export type AiFilterErrorCode = "no_provider" | "provider_error" | "invalid_json" | "invalid_request" | "rate_limited";

export type AiFilterSuggestion =
  | ({ ok: true } & AiFilterValidation)
  | { ok: false; error: AiFilterErrorCode; message: string };
