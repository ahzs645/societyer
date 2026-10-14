import { FIELD_TYPES, type ViewFilterOperator } from "../../platform/record-engine/types";
import type { NlField, NlFieldOption, NlNode } from "./types";
import { counterpartyFields, isDateField, isNumericField, isOptionField, isTextLikeField, nameFields, peopleFields } from "./fields";
import { makeCondition } from "./describe";
import { STOPWORDS, USED, consume, fuzzyWordMatch, matchAll, phrasePattern, splitIdentifier, wordVariants, type Clause } from "./text";
import { aliasAfter, aliasBefore, aliasesFor, conditionNode, readValue, type ExtractContext, type Found } from "./extractShared";

/* -------------------------------- Booleans -------------------------------- */

/** "archived", "not archived", "non-voting", "with voting rights". */
export function extractBooleans(clause: Clause, ctx: ExtractContext, out: Found[]) {
  for (const field of ctx.fields.filter((entry) => entry.type === FIELD_TYPES.BOOLEAN)) {
    const phrases: [string, boolean][] = aliasesFor(ctx, (entry) => entry === field).map(({ alias }) => [alias, true]);
    if (field.trueLabel) phrases.unshift([field.trueLabel.toLowerCase(), true]);
    if (field.falseLabel) phrases.unshift([field.falseLabel.toLowerCase(), false]);
    phrases.sort((a, b) => b[0].length - a[0].length);
    for (const [phrase, positive] of phrases) {
      const pattern = new RegExp(
        String.raw`(?<![\w${USED}])(?:(not|non-?|no|without|isn't|aren't|un)\s*)?(?:(?:is|are|with|has|have|having)\s+)?(${phrasePattern(phrase)})(?![\w${USED}])`,
        "g",
      );
      for (const match of matchAll(clause, pattern)) {
        const negated = Boolean(match[1]);
        const truthy = negated ? !positive : positive;
        consume(clause, match.index, match.index + match[0].length);
        out.push({ start: match.index, node: conditionNode(makeCondition(field, truthy ? "isTrue" : "isFalse", null)) });
      }
    }
  }
}

/* --------------------------------- Options --------------------------------- */

const OPTION_SYNONYMS: string[][] = [
  ["done", "completed", "complete", "finished"],
  ["to do", "todo", "not started"],
  ["in progress", "ongoing", "underway", "started", "in-progress"],
  ["cancelled", "canceled"],
  ["overdue", "past due", "late"],
  ["active", "current"],
  ["pending", "awaiting", "waiting"],
  ["uncategorised", "uncategorized"],
];

type OptionRef = { field: NlField; option: NlFieldOption };

function optionPhrases(option: NlFieldOption): string[] {
  const base = new Set<string>();
  const add = (value: string) => {
    const clean = value.toLowerCase().replace(/[()]/g, " ").replace(/[\s-]+/g, " ").trim();
    if (clean.length >= 2) base.add(clean);
  };
  add(option.label);
  add(splitIdentifier(option.value));
  // "Unknown (from source)" is also just "unknown".
  add(option.label.replace(/\(.*?\)/g, ""));
  for (const phrase of [...base]) {
    for (const group of OPTION_SYNONYMS) if (group.includes(phrase)) group.forEach((entry) => add(entry));
    for (const variant of wordVariants(phrase)) add(variant);
  }
  return [...base];
}

function optionIndex(fields: NlField[]) {
  const index = new Map<string, OptionRef[]>();
  for (const field of fields.filter(isOptionField)) {
    for (const option of field.options!) {
      for (const phrase of optionPhrases(option)) {
        const list = index.get(phrase) ?? [];
        if (!list.some((ref) => ref.field === field)) list.push({ field, option });
        index.set(phrase, list);
      }
    }
  }
  return index;
}

type Token = { text: string; start: number; end: number };

function tokens(clause: Clause): Token[] {
  const list: Token[] = [];
  const pattern = /[^\s¦]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clause.mask))) {
    const text = match[0].replace(/^['"]+|['",]+$/g, "");
    if (text) list.push({ text: text.replace(/-/g, " "), start: match.index, end: match.index + match[0].length });
  }
  return list;
}

/** Tokens i..j are contiguous (no used text between them). */
function contiguous(clause: Clause, list: Token[], from: number, to: number) {
  return !clause.mask.slice(list[from].start, list[to].end).includes(USED);
}

const NEGATIONS = /^(not|non|except|excluding|isn't|aren't|no|without)$/;

function lookupPhrase(index: Map<string, OptionRef[]>, phrase: string, allowFuzzy: boolean): OptionRef[] | undefined {
  const direct = index.get(phrase) ?? (phrase.endsWith("s") ? index.get(phrase.slice(0, -1)) : undefined);
  if (direct || !allowFuzzy || phrase.includes(" ")) return direct;
  for (const [known, refs] of index) {
    if (!known.includes(" ") && fuzzyWordMatch(phrase, known)) return refs;
  }
  return undefined;
}

function choose(refs: OptionRef[], clause: Clause, start: number, end: number, ctx: ExtractContext) {
  if (refs.length === 1) return { ref: refs[0], aliasHit: null as ReturnType<typeof aliasBefore> };
  for (const ref of refs) {
    const hit = aliasBefore(clause, start, ctx, (field) => field === ref.field) ?? aliasAfter(clause, end, ctx, (field) => field === ref.field);
    if (hit) return { ref, aliasHit: hit };
  }
  const preferred = refs.find((ref) => /status|state|stage/i.test(`${ref.field.name} ${ref.field.label}`)) ?? refs[0];
  const others = refs.filter((ref) => ref !== preferred).map((ref) => ref.field.label);
  ctx.notes.push(`“${preferred.option.label}” matched ${preferred.field.label} (it is also a ${others.join(", ")} value).`);
  return { ref: preferred, aliasHit: null };
}

/** "active members", "high priority", "not done", "drafts": option labels anywhere. */
export function extractOptions(clause: Clause, ctx: ExtractContext, out: Found[]) {
  const index = optionIndex(ctx.fields);
  if (!index.size) return;
  const found: { start: number; ref: OptionRef; negated: boolean }[] = [];
  for (let size = 4; size >= 1; size -= 1) {
    const list = tokens(clause);
    for (let i = 0; i + size <= list.length; i += 1) {
      if (!contiguous(clause, list, i, i + size - 1)) continue;
      let words = list.slice(i, i + size).map((token) => token.text);
      let negated = false;
      if (words[0].startsWith("non ") && size === 1) {
        words = [words[0].slice(4)];
        negated = true;
      }
      const phrase = words.join(" ");
      if (size === 1 && STOPWORDS.has(phrase)) continue;
      const refs = lookupPhrase(index, phrase, size === 1);
      if (!refs) continue;
      const start = list[i].start;
      const end = list[i + size - 1].end;
      const { ref, aliasHit } = choose(refs, clause, start, end, ctx);
      const previous = list[i - 1];
      let spanStart = start;
      if (previous && NEGATIONS.test(previous.text) && !clause.mask.slice(previous.end, start).includes(USED)) {
        negated = true;
        spanStart = previous.start;
      }
      const alias = aliasHit ?? aliasAfter(clause, end, ctx, (field) => field === ref.field) ?? aliasBefore(clause, spanStart, ctx, (field) => field === ref.field);
      consume(clause, Math.min(spanStart, alias?.start ?? spanStart), Math.max(end, alias?.end ?? end));
      found.push({ start: spanStart, ref, negated });
      // Re-tokenise: the consumed span changed the token list.
      i = list.length;
      size += 1;
    }
  }
  for (const entry of found) out.push({ start: entry.start, node: optionNode(entry.ref, entry.negated) });
}

function optionNode(ref: OptionRef, negated: boolean): NlNode {
  const { field, option } = ref;
  if (field.type === FIELD_TYPES.MULTI_SELECT) {
    return conditionNode(makeCondition(field, negated ? "notContains" : "contains", option.value));
  }
  return conditionNode(makeCondition(field, negated ? "neq" : "eq", option.value));
}

/* ------------------------- Field-scoped free text ------------------------- */

const TEXT_OPERATORS: [RegExp, ViewFilterOperator][] = [
  [/^(?:is\s+not|isn't|is\s+not\s+like|doesn't\s+contain|does\s+not\s+contain|not\s+containing|not)$/, "notContains"],
  [/^(?:=|equals|is\s+exactly|exactly)$/, "eq"],
  [/^(?:starts\s+with|starting\s+with|begins\s+with)$/, "startsWith"],
  [/^(?:ends\s+with|ending\s+with|ending\s+in)$/, "endsWith"],
];

/** "category rent", "status is active", "account: chequing", "notes contain 'grant'". */
export function extractFieldScoped(clause: Clause, ctx: ExtractContext, out: Found[]) {
  const index = optionIndex(ctx.fields);
  const candidates = aliasesFor(ctx, (field) => !isDateField(field) && !isNumericField(field) && field.type !== FIELD_TYPES.BOOLEAN);
  const linking = String.raw`(?:is\s+not\s+like|is\s+not|isn't|doesn't\s+contain|does\s+not\s+contain|not\s+containing|is\s+exactly|starts\s+with|starting\s+with|begins\s+with|ends\s+with|ending\s+with|ending\s+in|equals|contains|containing|contain|includes|including|is\s+like|like|matching|matches|is|are|=|:|not)`;
  for (const { field, alias } of candidates) {
    const pattern = new RegExp(String.raw`(?<![\w${USED}])(${phrasePattern(alias)})(?:\s*(${linking}))?\s+`, "g");
    for (const match of matchAll(clause, pattern)) {
      if (clause.mask.slice(match.index, match.index + match[0].length).includes(USED)) continue;
      const linkWord = (match[2] ?? "").replace(/\s+/g, " ").trim();
      const valueStart = match.index + match[0].length;
      if (isOptionField(field)) {
        const value = readValue(clause, valueStart);
        if (!value) continue;
        const words = value.text.toLowerCase().replace(/-/g, " ").split(/\s+/);
        // Longest option phrase at the start of the value.
        for (let size = Math.min(4, words.length); size >= 1; size -= 1) {
          const refs = lookupPhrase(index, words.slice(0, size).join(" "), size === 1)?.filter((ref) => ref.field === field);
          if (!refs?.length) continue;
          const consumedEnd = valueStart + clause.mask.slice(valueStart).indexOf(words[size - 1]) + words[size - 1].length;
          consume(clause, match.index, consumedEnd);
          const negated = /not|isn't/.test(linkWord);
          out.push({ start: match.index, node: optionNode(refs[0], negated) });
          break;
        }
        continue;
      }
      if (!isTextLikeField(field)) continue;
      const value = readValue(clause, valueStart);
      if (!value || STOPWORDS.has(value.text.toLowerCase())) continue;
      const operator = TEXT_OPERATORS.find(([test]) => test.test(linkWord))?.[1] ?? "contains";
      consume(clause, match.index, value.end);
      out.push({ start: match.index, node: conditionNode(makeCondition(field, operator, value.text)) });
    }
  }
}

/* ------------------------- Prepositional free text ------------------------- */

function anyOf(fields: NlField[], value: string): NlNode {
  if (fields.length === 1) return conditionNode(makeCondition(fields[0], "contains", value));
  return { kind: "group", operator: "or", children: fields.map((field) => conditionNode(makeCondition(field, "contains", value))) };
}

/** "named Patel", "assigned to Sam", "from Coastal Hydro", "to Jane". */
export function extractPrepositional(clause: Clause, ctx: ExtractContext, out: Found[]) {
  const rules: [string, NlField[]][] = [
    [String.raw`named|called|titled|name\s+(?:is|contains|like)|with\s+(?:the\s+)?name|whose\s+name\s+(?:is|contains)`, nameFields(ctx.fields)],
    [String.raw`assigned\s+to|owned\s+by|handled\s+by|led\s+by|managed\s+by|assignee\s+is|owner\s+is|by`, peopleFields(ctx.fields)],
    [String.raw`paid\s+to|sent\s+to|received\s+from|from|to|at|via|payee|vendor|merchant`, counterpartyFields(ctx.fields)],
  ];
  for (const [words, fields] of rules) {
    if (!fields.length) continue;
    for (const match of matchAll(clause, new RegExp(String.raw`(?<![\w${USED}])(?:${words})\s+`, "g"))) {
      if (clause.mask.slice(match.index, match.index + match[0].length).includes(USED)) continue;
      const value = readValue(clause, match.index + match[0].length);
      if (!value || STOPWORDS.has(value.text.toLowerCase())) continue;
      consume(clause, match.index, value.end);
      out.push({ start: match.index, node: anyOf(fields, value.text) });
    }
  }
}
