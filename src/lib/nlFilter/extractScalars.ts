import { FIELD_TYPES, type ViewFilterOperator } from "../../platform/record-engine/types";
import type { DateRangeValue } from "../dateRanges";
import { formatCalendarDate } from "../dateRanges";
import type { NlField } from "./types";
import { defaultAmountField, defaultDateField, directionField, isDateField, isNumericField, isOptionField, peopleFields } from "./fields";
import { DATE_EXPR_SOURCE, applyPrefix, describeParsedDate, parseDateExpression, prefixKind } from "./dates";
import { describeCondition, describeValue, makeCondition } from "./describe";
import { MONEY_SOURCE, USED, consume, fuzzyWordMatch, looksLikeYear, matchAll, parseMoneyWords, phrasePattern, type Clause } from "./text";
import { aliasBefore, aliasesFor, conditionNode, type ExtractContext, type Found } from "./extractShared";

/* ------------------------------ Empty checks ------------------------------ */

const NO_WORDS = String.raw`(?:with\s+no|without(?:\s+an?)?|has\s+no|have\s+no|having\s+no|missing(?:\s+an?)?|lacking(?:\s+an?)?|no)`;

/** "with no receipt", "without category", "notes empty", "uncategorised", "unassigned". */
export function extractEmptyChecks(clause: Clause, ctx: ExtractContext, out: Found[]) {
  const candidates = aliasesFor(ctx, (field) => field.type !== FIELD_TYPES.BOOLEAN);
  for (const { field, alias } of candidates) {
    const phrase = phrasePattern(alias);
    const patterns: [RegExp, ViewFilterOperator][] = [
      [new RegExp(String.raw`(?<![\w${USED}])${NO_WORDS}\s+(${phrase})(?![\w${USED}])`, "g"), "isEmpty"],
      [new RegExp(String.raw`(?<![\w${USED}])(${phrase})\s+(?:is\s+|are\s+)?(?:empty|blank|missing|not\s+set|unset)(?![\w${USED}])`, "g"), "isEmpty"],
      [new RegExp(String.raw`(?<![\w${USED}])(?:with|has|have|having|that\s+have)\s+(?:an?\s+)?(${phrase})(?=\s*$|\s+(?:and|or)\b)`, "g"), "isNotEmpty"],
    ];
    for (const [pattern, operator] of patterns) {
      for (const match of matchAll(clause, pattern)) {
        consume(clause, match.index, match.index + match[0].length);
        out.push({ start: match.index, node: conditionNode(makeCondition(field, operator, null)) });
      }
    }
  }
  const categoryOptions = ctx.fields.some((field) => isOptionField(field) && field.options!.some((option) => /un-?categori[sz]ed/i.test(option.label)));
  if (!categoryOptions) {
    const category = ctx.fields.find((field) => /categor/i.test(`${field.name} ${field.label}`) && field.type !== FIELD_TYPES.BOOLEAN);
    for (const match of matchAll(clause, /(?<![\w¦])un-?categori[sz]ed(?![\w¦])/g)) {
      if (!category) continue;
      consume(clause, match.index, match.index + match[0].length);
      out.push({ start: match.index, node: conditionNode(makeCondition(category, "isEmpty", null)) });
    }
  }
  for (const match of matchAll(clause, /(?<![\w¦])unassigned(?![\w¦])/g)) {
    const people = peopleFields(ctx.fields);
    if (!people.length) continue;
    consume(clause, match.index, match.index + match[0].length);
    for (const field of people) out.push({ start: match.index, node: conditionNode(makeCondition(field, "isEmpty", null)) });
  }
  for (const match of matchAll(clause, /(?<![\w¦])undated(?![\w¦])/g)) {
    const field = defaultDateField(ctx.fields);
    if (!field) continue;
    consume(clause, match.index, match.index + match[0].length);
    out.push({ start: match.index, node: conditionNode(makeCondition(field, "isEmpty", null)) });
  }
}

/* --------------------------------- Dates --------------------------------- */

const DATE_PREFIX = String.raw`(since|from|starting(?:\s+(?:from|on))?|beginning|as\s+of|on\s+or\s+after|on\s+or\s+before|after|before|prior\s+to|earlier\s+than|older\s+than|until|till|through|no\s+later\s+than|in|during|on|for|of|within)`;
const DONE_LIKE = /^(done|completed?|cancell?ed|closed|filed|paid|resolved|archived|finished|withdrawn)$/i;

export function extractDates(clause: Clause, ctx: ExtractContext, out: Found[]) {
  const dateFields = ctx.fields.filter(isDateField);
  if (!dateFields.length) return;
  const expr = `(?:${DATE_EXPR_SOURCE})`;
  const pattern = new RegExp(
    String.raw`(?<![\w${USED}])(?:(between|from)\s+(?:the\s+)?(${expr})\s+(?:and|to|until|till|through|-)\s+(?:the\s+)?(${expr})|${DATE_PREFIX}\s+(?:the\s+)?(${expr})|(${expr}))(?![\w${USED}])`,
    "g",
  );
  const found: { start: number; field: NlField; value: DateRangeValue; phrase: string }[] = [];
  for (const match of matchAll(clause, pattern)) {
    let value: DateRangeValue | null = null;
    if (match[1]) {
      const from = parseDateExpression(match[2], ctx.context);
      const to = parseDateExpression(match[3], ctx.context);
      if (!from?.bounds || !to?.bounds) continue;
      value = { start: from.bounds.start, end: to.bounds.end };
    } else {
      const raw = match[5] ?? match[6];
      const parsed = parseDateExpression(raw, ctx.context);
      if (!parsed) continue;
      // "from last week" means during it; "from March 2026" means since.
      const relative = /^(?:the\s+)?(?:this|last|next|past|previous|current|prior|today|yesterday|tomorrow)\b/.test(raw);
      const prefix = match[4] && /^from$/.test(match[4]) && relative ? "in" : prefixKind(match[4]);
      if (prefix === "none" && parsed.weak) continue;
      value = applyPrefix(parsed, prefix);
      if (!value || (!parsed.bounds && parsed.note)) {
        if (parsed.note && !ctx.notes.includes(parsed.note)) ctx.notes.push(parsed.note);
        continue;
      }
    }
    const named = aliasBefore(clause, match.index, ctx, isDateField);
    const field = named?.field ?? defaultDateField(dateFields);
    if (!field) continue;
    const start = named?.start ?? match.index;
    consume(clause, start, match.index + match[0].length);
    found.push({ start, field, value, phrase: match[0] });
  }
  // "since 2024 before 2025" on one column becomes one range.
  for (const entry of found) {
    const partner = found.find((other) => other !== entry && other.field === entry.field && !!other.value.start !== !!entry.value.start && !other.value.preset && !entry.value.preset && (!other.value.start || !other.value.end) && (!entry.value.start || !entry.value.end));
    if (partner && entry.value.start && !entry.value.end) {
      entry.value = { start: entry.value.start, end: partner.value.end };
      entry.phrase = `${entry.phrase} ${partner.phrase}`;
      found.splice(found.indexOf(partner), 1);
    }
  }
  for (const entry of found) {
    const { text, detail } = describeParsedDate(entry.phrase, entry.value);
    out.push({ start: entry.start, node: conditionNode(makeCondition(entry.field, "between", entry.value, `${entry.field.label}: ${text}`, detail)) });
  }
  extractOverdue(clause, ctx, out);
}

/** "overdue" / "past due" without an Overdue option: due before today and not finished. */
function extractOverdue(clause: Clause, ctx: ExtractContext, out: Found[]) {
  const hasOption = ctx.fields.some((field) => isOptionField(field) && field.options!.some((option) => /overdue|past due|late/i.test(option.label)));
  if (hasOption) return;
  const due = ctx.fields.find((field) => isDateField(field) && /due|deadline/i.test(`${field.name} ${field.label}`));
  if (!due) return;
  for (const match of matchAll(clause, /(?<![\w¦])(?:overdue|past\s+due|late)(?![\w¦])/g)) {
    consume(clause, match.index, match.index + match[0].length);
    out.push({
      start: match.index,
      node: conditionNode(makeCondition(due, "lt", ctx.context.today, `${due.label} before today`, formatCalendarDate(ctx.context.today))),
    });
    const status = ctx.fields.find((field) => field.type === FIELD_TYPES.SELECT && /status|state|stage/i.test(`${field.name} ${field.label}`) && field.options!.some((option) => DONE_LIKE.test(option.label) || DONE_LIKE.test(option.value)));
    if (status) {
      const finished = status.options!.filter((option) => DONE_LIKE.test(option.label) || DONE_LIKE.test(option.value)).map((option) => option.value);
      out.push({ start: match.index + 0.5, node: conditionNode(makeCondition(status, "notIn", finished)) });
    }
  }
}

/** "open" / "outstanding" without such an option: status is not a finished one. */
export function extractOpen(clause: Clause, ctx: ExtractContext, out: Found[]) {
  const words = /(?<![\w\u00a6])(open|outstanding|incomplete|unfinished|unresolved|not\s+finished)(?![\w\u00a6])/g;
  const status = ctx.fields.find((field) => field.type === FIELD_TYPES.SELECT && /status|state|stage/i.test(`${field.name} ${field.label}`) && field.options!.some((option) => DONE_LIKE.test(option.label) || DONE_LIKE.test(option.value)));
  if (!status) return;
  for (const match of matchAll(clause, words)) {
    const word = match[1].replace(/\s+/g, " ");
    if (ctx.fields.some((field) => isOptionField(field) && field.options!.some((option) => option.label.toLowerCase() === word))) continue;
    consume(clause, match.index, match.index + match[0].length);
    const finished = status.options!.filter((option) => DONE_LIKE.test(option.label) || DONE_LIKE.test(option.value)).map((option) => option.value);
    out.push({ start: match.index, node: conditionNode(makeCondition(status, "notIn", finished)) });
  }
}

/* ------------------------------- Direction ------------------------------- */

const OUT_WORDS = String.raw`money\s+out|money\s+spent|outgoing|outgoings|outflows?|expenses?|expenditures?|spending|spend|spent|payments?|paid\s+out|paid|withdrawals?|debits?|charges?|purchases?|bills?|costs?`;
const IN_WORDS = String.raw`money\s+in|incoming|inflows?|income|deposits?|revenues?|credits?|received|earnings|donations?|refunds?`;

export type Direction = { dir: "in" | "out"; start: number; end: number };

/** "payments" / "money in" — only for tables that have an amount or a direction column. */
export function detectDirection(clause: Clause, ctx: ExtractContext): Direction | null {
  if (!defaultAmountField(ctx.fields) && !directionField(ctx.fields)) return null;
  const optionWords = ctx.fields.filter(isOptionField).flatMap((field) => field.options!.map((option) => option.label.toLowerCase()));
  const hits: Direction[] = [];
  for (const [dir, source] of [["out", OUT_WORDS], ["in", IN_WORDS]] as const) {
    for (const match of matchAll(clause, new RegExp(String.raw`(?<![\w${USED}])(?:${source})(?![\w${USED}])`, "g"))) {
      const word = match[0].replace(/\s+/g, " ");
      // An option with that name ("Paid", "Expense") is a select value, not a direction.
      if (optionWords.some((option) => option === word || fuzzyWordMatch(word.replace(/s$/, ""), option))) continue;
      hits.push({ dir, start: match.index, end: match.index + match[0].length });
    }
  }
  if (!hits.length) return null;
  if (hits.some((hit) => hit.dir !== hits[0].dir)) {
    ctx.notes.push("Both money in and money out were mentioned, so direction was left out.");
    return null;
  }
  for (const hit of hits.slice(1)) consume(clause, hit.start, hit.end);
  return hits[0];
}

/* -------------------------------- Amounts -------------------------------- */

const OPERATOR_WORDS: [string, ViewFilterOperator][] = [
  [String.raw`at\s+least|no\s+less\s+than|not\s+less\s+than|minimum(?:\s+of)?|min|over|above|starting\s+at|>=`, "gte"],
  [String.raw`more\s+than|greater\s+than|bigger\s+than|larger\s+than|higher\s+than|exceeding|exceeds|in\s+excess\s+of|>`, "gt"],
  [String.raw`at\s+most|no\s+more\s+than|not\s+more\s+than|maximum(?:\s+of)?|max|up\s+to|not\s+over|<=`, "lte"],
  [String.raw`less\s+than|fewer\s+than|smaller\s+than|lower\s+than|cheaper\s+than|under|below|<`, "lt"],
];

type AmountHit = { start: number; end: number; field: NlField; operator: ViewFilterOperator; dollars: number };

const hasMark = (raw: string) => /\$|k\b|m\b|bn|thousand|million|grand/i.test(raw);

function amountHits(clause: Clause, ctx: ExtractContext): AmountHit[] {
  const money = `(${MONEY_SOURCE})`;
  const hits: AmountHit[] = [];
  const fieldFor = (index: number) => {
    const named = aliasBefore(clause, index, ctx, isNumericField);
    const field = named?.field ?? defaultAmountField(ctx.fields);
    return field ? { field, start: named?.start ?? index } : null;
  };
  const push = (index: number, end: number, entries: [ViewFilterOperator, string][]) => {
    const target = fieldFor(index);
    if (!target) return;
    const parsed = entries.map(([operator, raw]) => [operator, parseMoneyWords(raw)] as const);
    if (parsed.some(([, dollars]) => dollars === undefined)) return;
    consume(clause, target.start, end);
    for (const [operator, dollars] of parsed) hits.push({ start: target.start, end, field: target.field, operator, dollars: dollars! });
  };
  const lead = String.raw`(?<![\w$${USED}])`;
  for (const match of matchAll(clause, new RegExp(String.raw`${lead}(?:between|from)\s+${money}\s*(?:and|to|-)\s*${money}(?![\w${USED}])`, "g"))) {
    if (looksLikeYear(match[1]) && looksLikeYear(match[2])) continue;
    const [low, high] = [match[1], match[2]].sort((a, b) => (parseMoneyWords(a) ?? 0) - (parseMoneyWords(b) ?? 0));
    push(match.index, match.index + match[0].length, [["gte", low], ["lte", high]]);
  }
  for (const match of matchAll(clause, new RegExp(String.raw`${lead}${money}\s*(?:-|to)\s*${money}(?![\w${USED}])`, "g"))) {
    if (!hasMark(match[1]) && !hasMark(match[2])) continue;
    push(match.index, match.index + match[0].length, [["gte", match[1]], ["lte", match[2]]]);
  }
  for (const [words, operator] of OPERATOR_WORDS) {
    for (const match of matchAll(clause, new RegExp(String.raw`(?<![\w${USED}])(?:${words})\s*${money}(?![\w${USED}])`, "g"))) {
      push(match.index, match.index + match[0].length, [[operator, match[1]]]);
    }
  }
  const postfix: [string, ViewFilterOperator][] = [
    [String.raw`\s*\+|\s+(?:or\s+more|or\s+above|or\s+over|and\s+up|and\s+above|and\s+over|plus|or\s+higher)`, "gte"],
    [String.raw`\s+(?:or\s+less|or\s+under|or\s+below|and\s+under|and\s+below|or\s+lower)`, "lte"],
  ];
  for (const [words, operator] of postfix) {
    for (const match of matchAll(clause, new RegExp(String.raw`${lead}${money}(?:${words})(?![\w${USED}])`, "g"))) {
      push(match.index, match.index + match[0].length, [[operator, match[1]]]);
    }
  }
  for (const match of matchAll(clause, new RegExp(String.raw`(?<![\w${USED}])(?:exactly|equal\s+to|equals|=)\s*${money}(?![\w${USED}])`, "g"))) {
    push(match.index, match.index + match[0].length, [["eq", match[1]]]);
  }
  for (const match of matchAll(clause, new RegExp(String.raw`(?<![\w${USED}])(?:(?:of|for|at)\s+)?(\$\s?\d+(?:,\d{3})*(?:\.\d+)?(?:\s?(?:k|m|bn|thousand|million|grand)\b)?)(?![\w${USED}])`, "g"))) {
    push(match.index, match.index + match[0].length, [["eq", match[1]]]);
  }
  return hits;
}

const FLIP: Partial<Record<ViewFilterOperator, ViewFilterOperator>> = { gte: "lte", gt: "lt", lte: "gte", lt: "gt", eq: "eq" };

/**
 * Amount comparisons, with money direction. Signed amounts (expenses stored
 * negative) turn "payments over 1.5k" into "Amount ≤ −$1,500"; a direction
 * select (Type: Expense) becomes its own condition instead.
 */
export function extractAmounts(clause: Clause, ctx: ExtractContext, out: Found[]) {
  const direction = detectDirection(clause, ctx);
  const hits = amountHits(clause, ctx);
  const dirSelect = directionField(ctx.fields);
  const signedField = dirSelect ? undefined : defaultAmountField(ctx.fields);

  if (direction && dirSelect) {
    const value = direction.dir === "in" ? dirSelect.in : dirSelect.out;
    if (value) {
      consume(clause, direction.start, direction.end);
      out.push({ start: direction.start, node: conditionNode(makeCondition(dirSelect.field, "eq", value)) });
    }
  }

  for (const hit of hits) {
    const stored = hit.field.type === FIELD_TYPES.CURRENCY && hit.field.isCents ? Math.round(hit.dollars * 100) : hit.dollars;
    const signed = direction && !dirSelect && hit.field === signedField;
    if (signed) {
      const operator = direction.dir === "out" ? FLIP[hit.operator] ?? hit.operator : hit.operator;
      const value = direction.dir === "out" ? -stored : stored;
      const text = describeCondition(hit.field, hit.operator, stored).replace(hit.field.label, direction.dir === "out" ? "Money out" : "Money in");
      out.push({ start: hit.start, node: conditionNode(makeCondition(hit.field, operator, value, text, describeCondition(hit.field, operator, value))) });
    } else {
      out.push({ start: hit.start, node: conditionNode(makeCondition(hit.field, hit.operator, stored)) });
    }
  }
  const usedDirection = direction && !dirSelect && signedField;
  if (usedDirection) {
    consume(clause, direction.start, direction.end);
    // "Payments over 1.5k" already implies money out; "payments under 50" still needs the sign.
    const needsSign = !hits.some((hit) => hit.field === signedField && hit.dollars > 0 && (hit.operator === "gte" || hit.operator === "gt" || hit.operator === "eq"));
    if (needsSign) {
      const operator: ViewFilterOperator = direction.dir === "out" ? "lt" : "gt";
      out.push({
        start: direction.start,
        node: conditionNode(makeCondition(signedField, operator, 0, direction.dir === "out" ? "Money out" : "Money in", `${signedField.label} ${operator === "lt" ? "<" : ">"} ${describeValue(signedField, 0)}`)),
      });
    }
  }
}
