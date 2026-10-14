import { FIELD_TYPES, type ViewFilter, type ViewFilterGroup } from "../../platform/record-engine/types";
import type { NlCondition, NlContext, NlField, NlNode, NlParseResult } from "./types";
import { describeCondition, describeNode, makeCondition } from "./describe";
import { exampleQueries } from "./examples";
import { conditionNode, readValue, type ExtractContext, type Found } from "./extractShared";
import { extractAmounts, extractDates, extractEmptyChecks, extractOpen } from "./extractScalars";
import { extractBooleans, extractFieldScoped, extractOptions, extractPrepositional } from "./extractValues";
import { consume, leftoverWords, makeClause, matchAll, normalizeQuery, phrasePattern, type Clause } from "./text";

/**
 * Deterministic natural-language → RecordTable filter parser. Works offline
 * from the table's field metadata only (no rows, no network).
 *
 *   parseNlFilter("payments over 1.5k this year", fields, { today: "2026-10-14" })
 *   → Amount ≤ −$1,500 · Date: this year
 *
 * Words it cannot place are returned in `ignored` (status "partial") so the UI
 * never applies a half-understood request without saying so.
 */
export function parseNlFilter(input: string, fields: NlField[], context: NlContext): NlParseResult {
  const query = normalizeQuery(input ?? "");
  const base: NlParseResult = { status: "empty", query, root: null, filters: [], filterGroups: [], chips: [], ignored: [], notes: [], suggestions: [], source: "parser" };
  if (!query) return base;

  const notes: string[] = [];
  const ctx: ExtractContext = { fields, context, notes };
  const nounWords = nounSet(context);
  const clauses: { clause: Clause; nodes: NlNode[] }[] = [];
  for (const text of splitOr(query)) {
    const clause = makeClause(text);
    const nodes = parseClause(clause, ctx, nounWords);
    const previous = clauses[clauses.length - 1];
    if (previous) inheritField(clause, nodes, previous.nodes, fields);
    clauses.push({ clause, nodes });
  }
  const ignored = clauses.flatMap(({ clause }) => leftoverWords(clause, nounWords));
  const root = combine(clauses.map(({ nodes }) => nodes), fields);
  const conditionCount = root ? countConditions(root.children) : 0;

  if (!root || conditionCount === 0) {
    return { ...base, status: "none", ignored, notes, suggestions: exampleQueries(fields, context) };
  }
  const { filters, filterGroups } = toFilterTree(root);
  return {
    ...base,
    status: ignored.length ? "partial" : "ok",
    root,
    filters,
    filterGroups,
    chips: root.children.map(describeNode),
    ignored,
    notes: [...new Set(notes)],
  };
}

function nounSet(context: NlContext) {
  const words = new Set<string>();
  for (const noun of [context.objectLabelPlural, context.objectLabelSingular]) {
    if (!noun) continue;
    for (const word of noun.toLowerCase().split(/\s+/)) words.add(word);
  }
  return words;
}

/** Split on "or", except "or more / or less / or above…". */
function splitOr(query: string): string[] {
  return query
    .split(/\s+or\s+(?!(?:more|less|above|below|under|over|later|earlier|higher|lower)\b(?!\s*\$?\d))/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseClause(clause: Clause, ctx: ExtractContext, nouns: Set<string>): NlNode[] {
  const found: Found[] = [];
  // "Show me…", "find…": the request itself, not a condition.
  const lead = /^\s*(?:please\s+)?(?:show|find|list|get|give|display|filter)(?:\s+me)?(?![\w\u00a6])/.exec(clause.mask);
  if (lead) consume(clause, 0, lead[0].length);
  // The table's own noun ("members", "tasks") carries no condition.
  for (const noun of nouns) {
    for (const match of matchAll(clause, new RegExp(String.raw`(?<![\w¦])${phrasePattern(noun)}(?![\w¦])`, "g"))) {
      consume(clause, match.index, match.index + match[0].length);
    }
  }
  extractEmptyChecks(clause, ctx, found);
  extractDates(clause, ctx, found);
  extractOpen(clause, ctx, found);
  extractAmounts(clause, ctx, found);
  extractBooleans(clause, ctx, found);
  extractFieldScoped(clause, ctx, found);
  extractOptions(clause, ctx, found);
  extractPrepositional(clause, ctx, found);
  found.sort((a, b) => a.start - b.start);
  return mergeSameSelect(found.map((entry) => entry.node), ctx.fields);
}

/** "draft and pending" on a single select can only mean "is any of". */
function mergeSameSelect(nodes: NlNode[], fields: NlField[]): NlNode[] {
  const out: NlNode[] = [];
  for (const node of nodes) {
    if (node.kind !== "condition" || node.condition.operator !== "eq") {
      out.push(node);
      continue;
    }
    const field = fields.find((entry) => entry.id === node.condition.fieldId);
    if (field?.type !== FIELD_TYPES.SELECT) {
      out.push(node);
      continue;
    }
    const existing = out.find((entry): entry is Extract<NlNode, { kind: "condition" }> =>
      entry.kind === "condition" && entry.condition.fieldId === field.id && (entry.condition.operator === "eq" || entry.condition.operator === "in"));
    if (!existing) {
      out.push(node);
      continue;
    }
    const values = [...(existing.condition.operator === "in" ? (existing.condition.value as unknown[]) : [existing.condition.value]), node.condition.value];
    const unique = [...new Set(values.map(String))];
    existing.condition = { fieldId: field.id, operator: "in", value: unique, text: describeCondition(field, "in", unique) };
  }
  return out;
}

/**
 * Join "or" clauses. When every clause opens with a value of the same select
 * ("draft or pending this year"), the values become one "is any of" and the
 * rest is shared; otherwise each clause is its own all-of group.
 */
function combine(clauses: NlNode[][], fields: NlField[]): { operator: "and" | "or"; children: NlNode[] } | null {
  const nonEmpty = clauses.filter((nodes) => nodes.length > 0);
  if (nonEmpty.length === 0) return null;
  if (nonEmpty.length === 1) return { operator: "and", children: nonEmpty[0] };
  const heads = nonEmpty.map((nodes) => nodes[0]);
  const fieldId = heads[0].kind === "condition" ? heads[0].condition.fieldId : null;
  const headField = fields.find((field) => field.id === fieldId);
  const sameSelect = headField?.type === FIELD_TYPES.SELECT && heads.every((head) => head.kind === "condition" && head.condition.fieldId === fieldId && (head.condition.operator === "eq" || head.condition.operator === "in"));
  if (sameSelect) {
    const values = [...new Set(heads.flatMap((head) => {
      const condition = (head as Extract<NlNode, { kind: "condition" }>).condition;
      return condition.operator === "in" ? (condition.value as unknown[]).map(String) : [String(condition.value)];
    }))];
    const merged: NlCondition = { fieldId: headField.id, operator: "in", value: values, text: describeCondition(headField, "in", values) };
    return { operator: "and", children: [conditionNode(merged), ...nonEmpty.flatMap((nodes) => nodes.slice(1))] };
  }
  const sameText = headField && !headField.options?.length && heads.every((head) =>
    head.kind === "condition" && head.condition.fieldId === fieldId && TEXT_OPS.has(head.condition.operator) && head.condition.operator === (heads[0] as Extract<NlNode, { kind: "condition" }>).condition.operator);
  if (sameText) {
    const tails = nonEmpty.flatMap((nodes) => nodes.slice(1));
    if (!tails.length) return { operator: "or", children: heads };
    return { operator: "and", children: [{ kind: "group", operator: "or", children: heads }, ...tails] };
  }
  const children: NlNode[] = [];
  for (const nodes of nonEmpty) {
    if (nodes.length === 1 && nodes[0].kind === "group" && nodes[0].operator === "or") children.push(...nodes[0].children);
    else if (nodes.length === 1) children.push(nodes[0]);
    else children.push({ kind: "group", operator: "and", children: nodes });
  }
  return { operator: "or", children };
}

const TEXT_OPS = new Set(["contains", "eq", "notContains", "startsWith", "endsWith"]);

/**
 * "category is rent or utilities": a bare value opening an "or" clause takes
 * the column and operator of the previous clause's last free-text condition.
 */
function inheritField(clause: Clause, nodes: NlNode[], previous: NlNode[], fields: NlField[]) {
  const last = [...previous].reverse().find((node): node is Extract<NlNode, { kind: "condition" }> =>
    node.kind === "condition" && TEXT_OPS.has(node.condition.operator) && typeof node.condition.value === "string");
  const field = last && fields.find((entry) => entry.id === last.condition.fieldId);
  if (!last || !field || field.options?.length) return;
  const value = readValue(clause, 0);
  if (!value || clause.mask.slice(0, value.start).trim() !== "") return;
  consume(clause, value.start, value.end);
  nodes.unshift(conditionNode(makeCondition(field, last.condition.operator, value.text)));
}

function countConditions(nodes: NlNode[]): number {
  return nodes.reduce((total, node) => total + (node.kind === "condition" ? 1 : countConditions(node.children)), 0);
}

let treeSeq = 0;

/** NlNode tree → ViewFilter[] + ViewFilterGroup[] (same shape the filter editor writes). */
export function toFilterTree(root: { operator: "and" | "or"; children: NlNode[] }): { filters: ViewFilter[]; filterGroups: ViewFilterGroup[] } {
  treeSeq += 1;
  const stamp = `${Date.now().toString(36)}${treeSeq.toString(36)}`;
  let groupCount = 0;
  let filterCount = 0;
  const filters: ViewFilter[] = [];
  const filterGroups: ViewFilterGroup[] = [];
  const walk = (operator: "and" | "or", children: NlNode[], parentId: string | null, position: number) => {
    const id = `nlfg_${stamp}_${groupCount++}`;
    filterGroups.push({ id, parentViewFilterGroupId: parentId, logicalOperator: operator, positionInViewFilterGroup: position });
    let filterPosition = 0;
    let groupPosition = 0;
    for (const child of children) {
      if (child.kind === "condition") {
        filters.push({
          id: `nlf_${stamp}_${filterCount++}`,
          fieldMetadataId: child.condition.fieldId,
          operator: child.condition.operator,
          value: child.condition.value,
          viewFilterGroupId: id,
          positionInViewFilterGroup: filterPosition++,
        });
      } else {
        walk(child.operator, child.children, id, ++groupPosition);
      }
    }
  };
  walk(root.operator, root.children, null, 0);
  return { filters, filterGroups };
}
