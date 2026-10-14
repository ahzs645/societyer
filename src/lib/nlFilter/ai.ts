import { FIELD_TYPES, type ViewFilterOperator } from "../../platform/record-engine/types";
import { operatorsForField } from "../../platform/record-engine/record-table/utils/filterLabels";
import {
  AI_FILTER_OPERATORS,
  buildAiFilterPrompt as buildSharedPrompt,
  validateAiFilterJson,
  type AiFilterCondition,
  type AiFilterFieldSchema,
  type AiFilterOperator,
  type AiFilterValidation,
} from "../../../shared/nlFilterAi";
import type { NlContext, NlField, NlNode, NlParseResult } from "./types";
import { describeNode, makeCondition } from "./describe";
import { conditionNode } from "./extractShared";
import { toFilterTree } from "./parse";

export { extractJsonObject } from "../../../shared/nlFilterAi";

/**
 * Optional AI path for requests the offline parser can't place. The model sees
 * ONLY the column schema, today's date and the request — never row data. The
 * prompt and the strict reply validator live in shared/nlFilterAi.ts so the
 * workspace server action and the device-local path use the same rules; this
 * module adapts them to the table's NlFields and NlParseResult.
 */

function allowedOperators(field: NlField): AiFilterOperator[] {
  const base = operatorsForField(field.type);
  const extra: ViewFilterOperator[] = field.type === FIELD_TYPES.RELATION ? ["contains"] : field.type === FIELD_TYPES.TEXT ? ["notContains"] : [];
  return [...new Set([...base, ...extra])].filter((operator): operator is AiFilterOperator => (AI_FILTER_OPERATORS as readonly string[]).includes(operator));
}

/** The schema sent to the AI path: column ids, labels, types, operators and option values. */
export function aiFilterSchema(fields: NlField[]): AiFilterFieldSchema[] {
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    operators: allowedOperators(field),
    ...(field.options?.length ? { options: field.options.map((option) => ({ value: option.value, label: option.label })) } : {}),
    ...(field.type === FIELD_TYPES.CURRENCY && field.isCents ? { isCents: true } : {}),
  }));
}

export function buildAiFilterPrompt(fields: NlField[], query: string, context: NlContext) {
  return buildSharedPrompt(aiFilterSchema(fields), query, { today: context.today, fiscalYearEnd: context.fiscalYearEnd ?? null });
}

/**
 * Turn a validated AI filter (from the server action or the local path) into
 * preview chips. Values are already normalised by the shared validator; a
 * condition naming a column this table no longer has is dropped and counted.
 */
export function aiFilterToParseResult(validation: AiFilterValidation, fields: NlField[], query: string): NlParseResult {
  const empty: NlParseResult = { status: "none", query, root: null, filters: [], filterGroups: [], chips: [], ignored: [], notes: [], suggestions: [], source: "ai" };
  let lost = 0;
  const toNode = (condition: AiFilterCondition): NlNode[] => {
    const field = fields.find((candidate) => candidate.id === condition.field);
    if (!field) {
      lost++;
      return [];
    }
    return [conditionNode(makeCondition(field, condition.operator as ViewFilterOperator, condition.value))];
  };
  const children: NlNode[] = [];
  if (validation.filter) {
    children.push(...validation.filter.conditions.flatMap(toNode));
    for (const group of validation.filter.groups) {
      const nodes = group.conditions.flatMap(toNode);
      if (nodes.length === 1) children.push(nodes[0]);
      else if (nodes.length > 1) children.push({ kind: "group", operator: group.operator, children: nodes });
    }
  }
  const dropped = validation.droppedCount + lost;
  const notes = dropped
    ? [`Left out ${dropped} suggested condition${dropped === 1 ? "" : "s"} that didn't fit this table.`]
    : validation.notes;
  const ignored = validation.unmatched;
  if (children.length === 0) return { ...empty, ignored, notes };
  const root = { operator: validation.filter?.operator === "or" ? ("or" as const) : ("and" as const), children };
  const tree = toFilterTree(root);
  return {
    ...empty,
    status: ignored.length || dropped ? "partial" : "ok",
    root,
    ...tree,
    chips: children.map(describeNode),
    ignored,
    notes,
  };
}

/** Strictly validate a model's JSON reply against the table's columns. Unknown fields or operators reject the condition. */
export function validateAiFilterReply(raw: unknown, fields: NlField[], query: string): NlParseResult {
  return aiFilterToParseResult(validateAiFilterJson(raw, aiFilterSchema(fields)), fields, query);
}
