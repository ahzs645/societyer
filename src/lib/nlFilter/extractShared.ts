import type { NlCondition, NlContext, NlField, NlNode } from "./types";
import { fieldAliases } from "./fields";
import { USED, phrasePattern, type Clause } from "./text";

export type Found = { start: number; node: NlNode };

export type ExtractContext = {
  fields: NlField[];
  context: NlContext;
  notes: string[];
};

export const conditionNode = (condition: NlCondition): NlNode => ({ kind: "condition", condition });

export type AliasHit = { field: NlField; start: number; end: number; alias: string };

/** Every (field, alias) pair, longest alias first, for fields passing `filter`. */
export function aliasesFor(ctx: ExtractContext, filter: (field: NlField) => boolean) {
  const pairs: { field: NlField; alias: string }[] = [];
  for (const field of ctx.fields) {
    if (!filter(field)) continue;
    for (const alias of fieldAliases(field, ctx.context)) pairs.push({ field, alias });
  }
  return pairs.sort((a, b) => b.alias.length - a.alias.length);
}

/**
 * A field named right before `index` ("amount over…", "joined since…",
 * "due date is…"), allowing a linking verb between them.
 */
export function aliasBefore(clause: Clause, index: number, ctx: ExtractContext, filter: (field: NlField) => boolean): AliasHit | null {
  const before = clause.mask.slice(0, index);
  for (const { field, alias } of aliasesFor(ctx, filter)) {
    const pattern = new RegExp(String.raw`(?<![\w${USED}])(${phrasePattern(alias)})\s+(?:(?:is|was|were|are|being|date|dated)\s+)?(?::\s*)?$`);
    const match = pattern.exec(before);
    if (match) return { field, alias, start: match.index, end: match.index + match[1].length };
  }
  return null;
}

/** A field named right after `index` ("high priority"). */
export function aliasAfter(clause: Clause, index: number, ctx: ExtractContext, filter: (field: NlField) => boolean): AliasHit | null {
  const after = clause.mask.slice(index);
  for (const { field, alias } of aliasesFor(ctx, filter)) {
    const pattern = new RegExp(String.raw`^\s+(${phrasePattern(alias)})(?![\w${USED}])`);
    const match = pattern.exec(after);
    if (match) {
      const start = index + match[0].length - match[1].length;
      return { field, alias, start, end: index + match[0].length };
    }
  }
  return null;
}

/** Words that end a free-text value ("from Coastal Hydro *this year*"). */
const VALUE_BOUNDARY = new Set([
  "and", "or", "with", "without", "in", "during", "since", "before", "after", "over", "under", "above", "below",
  "between", "from", "to", "that", "who", "which", "where", "whose", "not", "is", "are", "was", "were", "this",
  "last", "next", "named", "called", "by", "assigned", "paid", "sorted", "on", "for", "than", "more", "less",
  "exactly", "no", "but", "except", "excluding", "at", "via", "until", "till",
]);

const TRAILING_NOISE = new Set(["the", "a", "an", "of", "s"]);

/** A free-text value starting at `index`: a quoted string, or up to five words. */
export function readValue(clause: Clause, index: number): { text: string; start: number; end: number } | null {
  const rest = clause.mask.slice(index);
  const lead = /^\s*/.exec(rest)![0].length;
  const start = index + lead;
  if (clause.mask[start] === '"') {
    const close = clause.mask.indexOf('"', start + 1);
    if (close > start + 1 && !clause.mask.slice(start, close).includes(USED)) {
      return { text: clause.original.slice(start + 1, close).trim(), start, end: close + 1 };
    }
  }
  const pattern = /[^\s¦"]+/y;
  let cursor = start;
  let end = start;
  let words = 0;
  while (words < 5) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(clause.mask);
    if (!match || match.index !== cursor) break;
    const word = match[0].replace(/'s$/, "");
    if (VALUE_BOUNDARY.has(word) && words > 0) break;
    if (VALUE_BOUNDARY.has(word) && words === 0) return null;
    end = cursor + match[0].length;
    words += 1;
    const gap = /^ +/.exec(clause.mask.slice(end));
    if (!gap) break;
    cursor = end + gap[0].length;
  }
  if (words === 0) return null;
  // Drop dangling articles at the end ("to the").
  let text = clause.original.slice(start, end);
  let lower = clause.mask.slice(start, end);
  while (true) {
    const lastSpace = lower.lastIndexOf(" ");
    const last = lower.slice(lastSpace + 1);
    if (lastSpace < 0 || !TRAILING_NOISE.has(last)) break;
    lower = lower.slice(0, lastSpace);
    text = text.slice(0, lastSpace);
    end = start + lastSpace;
  }
  // "assigned to me": there is no signed-in person to match here.
  if (TRAILING_NOISE.has(lower) || /^(me|myself|us|you|i)$/.test(lower)) return null;
  return { text: text.trim().replace(/['"]+$/, ""), start, end };
}
