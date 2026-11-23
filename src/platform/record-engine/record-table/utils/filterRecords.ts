import { FIELD_TYPES, type FieldType, type SelectOption } from "../../types/FieldType";
import type { FieldMetadata } from "../../types/FieldMetadata";
import type { RecordField, ViewFilter, ViewFilterGroup, ViewFilterOperator } from "../../types/View";
import { compileViewFilters } from "./viewFilterGroups";
import { isDateInRange, isDateRangeValue, resolveDateRange, type DateRangeContext } from "../../../../lib/dateRanges";
import { todayDateOnly } from "../../../../../shared/dateOnly";
import { recordCellText } from "./recordCellText";

const TEXT_OPERATORS = new Set<ViewFilterOperator>([
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
]);

/** A record as the filters read it: field values by name. */
type FilterableRecord = Record<string, unknown>;
export type RecordPredicate = (record: FilterableRecord) => boolean;

/**
 * Field types whose "is" / "is any of" compare the text a person sees,
 * case-insensitively. Values picked from the distinct-value list (see
 * distinctFieldValues) match these exactly.
 */
const TEXT_EQUALITY_TYPES = new Set<FieldType>([
  FIELD_TYPES.TEXT,
  FIELD_TYPES.EMAIL,
  FIELD_TYPES.PHONE,
  FIELD_TYPES.LINK,
  FIELD_TYPES.UUID,
  FIELD_TYPES.ARRAY,
  FIELD_TYPES.RICH_TEXT,
]);

export function filterRecords<T extends object>({
  records,
  columns,
  filters,
  filterGroups,
  searchTerm,
  dateContext,
}: {
  records: T[];
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  searchTerm?: string;
  /** Organisation calendar for relative date-range filters. */
  dateContext?: DateRangeContext;
}): T[] {
  const terms = parseSearchTerms(searchTerm ?? "");
  if (filters.length === 0 && terms.length === 0) return records;
  // Filters are compiled once (field lookups, date ranges, option labels),
  // not re-derived for every record.
  const matches = filters.length > 0 ? compileViewFilters({ columns, filters, filterGroups, dateContext }) : null;
  const searchFields = terms.length > 0 ? columns.map((column) => column.field) : [];

  return records.filter((record) => {
    const row = record as FilterableRecord;
    if (matches && !matches(row)) return false;
    return terms.length === 0 || recordMatchesSearch(row, searchFields, terms);
  });
}

/* --------------------------------- search -------------------------------- */

/**
 * One word (or "quoted phrase") of a quick search, folded like the records'
 * text. `compact` is the word without its separators, for a word with a digit
 * or punctuation in it (a reference number), else null. `singular` is a plural
 * word's singular ("replacements" → "replacement"), else null.
 */
export type SearchTerm = { text: string; compact: string | null; singular: string | null };

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NOT_ASCII = /[\u0080-\uffff]/;
const SEPARATORS = /[^\p{L}\p{N}]+/gu;
const NEEDS_COMPACT = /[\p{N}]|[^\p{L}\p{N}\s]/u;

/** Lower case without accents, with typographic quotes as plain ones: "Montréal’s" reads "montreal's". */
export function foldSearchText(value: string): string {
  const lower = value.toLowerCase();
  if (!NOT_ASCII.test(lower)) return lower;
  return lower.normalize("NFD").replace(COMBINING_MARKS, "").replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
}

/**
 * A quick search as the table matches it: its words, each to be found
 * somewhere in a record (any field, any order), and "quoted phrases" kept
 * whole. Case and accents don't matter, and a word with a digit or
 * punctuation in it also matches with the separators left out on either side,
 * so "is27nri014" finds "IS27-NRI-014" and "rfp-0219" finds "RFP 0219".
 * A plural word also finds its singular as a whole word, so "roof
 * replacements" finds "Roof Replacement" (the singular already finds the
 * plural, as a substring).
 */
export function parseSearchTerms(searchTerm: string): SearchTerm[] {
  const folded = foldSearchText(searchTerm.trim());
  if (!folded) return [];
  const terms: SearchTerm[] = [];
  for (const match of folded.matchAll(/"([^"]+)"|(\S+)/g)) {
    const text = (match[1] ?? match[2].replace(/^"+|"+$/g, "")).trim();
    if (!text || terms.some((term) => term.text === text)) continue;
    const compact = NEEDS_COMPACT.test(text) ? text.replace(SEPARATORS, "") : "";
    terms.push({ text, compact: compact.length >= 2 ? compact : null, singular: match[1] ? null : singularOf(text) });
  }
  return terms;
}

const PLAIN_WORD = /^\p{L}{4,}$/u;

/**
 * An English plural's singular, for words of letters only: "supplies" →
 * "supply", "boxes" → "box", "services" → "service". Null for a word that
 * doesn't read as a plural ("analysis", "status", "glass").
 */
function singularOf(word: string): string | null {
  if (!PLAIN_WORD.test(word)) return null;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return null;
}

const LETTER = /\p{L}/u;

/**
 * Whether `word` is in `text` at the end of a word, so the singular of
 * "forests" finds "forest" and "rainforest" but not "forestry".
 */
function includesWordEnd(text: string, word: string): boolean {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    const next = text[at + word.length];
    if (next === undefined || !LETTER.test(next)) return true;
  }
  return false;
}

/** Whether every word of the search is in the record's text. */
export function recordMatchesSearch(record: FilterableRecord, fields: FieldMetadata[], terms: SearchTerm[]): boolean {
  const corpus = searchCorpus(record, fields);
  for (const term of terms) {
    if (corpus.text.includes(term.text)) continue;
    if (term.singular && includesWordEnd(corpus.text, term.singular)) continue;
    if (!term.compact) return false;
    corpus.compact ??= corpus.text.replace(SEPARATORS, "");
    if (!corpus.compact.includes(term.compact)) return false;
  }
  return true;
}

/* ---------------------------- search correction --------------------------- */

/**
 * For a search that finds nothing because of a misspelt word: the same search
 * with each word that is in no record swapped for the closest word that is
 * ("janitoral services" → "janitorial services"), when that search does find
 * records under the same filters. Null otherwise. Quoted phrases, reference
 * numbers and words under four letters are left as typed.
 */
export function suggestSearchCorrection<T extends object>({
  records,
  columns,
  filters,
  filterGroups,
  searchTerm,
  dateContext,
}: {
  records: T[];
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  searchTerm: string;
  dateContext?: DateRangeContext;
}): string | null {
  const terms = parseSearchTerms(searchTerm);
  if (terms.length === 0 || records.length === 0) return null;
  const fields = columns.map((column) => column.field);
  const texts = records.map((record) => searchCorpus(record as FilterableRecord, fields).text);
  let vocabulary: Map<string, number> | null = null;
  let changed = false;
  const words = terms.map((term) => {
    const typed = term.text.includes(" ") ? `"${term.text}"` : term.text;
    if (!PLAIN_WORD.test(term.text)) return typed;
    if (texts.some((text) => text.includes(term.text) || (term.singular !== null && includesWordEnd(text, term.singular)))) return typed;
    vocabulary ??= wordCounts(texts);
    const closest = closestWord(term.text, vocabulary);
    if (!closest) return typed;
    changed = true;
    return closest;
  });
  if (!changed) return null;
  const suggestion = words.join(" ");
  return filterRecords({ records, columns, filters, filterGroups, searchTerm: suggestion, dateContext }).length > 0 ? suggestion : null;
}

/** How often each word of three or more letters appears across `texts`. */
function wordCounts(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const word of text.split(/[^\p{L}]+/u)) {
      if (word.length >= 3) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The vocabulary word nearest `word` by edits (a letter added, dropped,
 * changed or two swapped): one edit for words up to five letters, two beyond.
 * Ties go to the more common word.
 */
function closestWord(word: string, vocabulary: Map<string, number>): string | null {
  const limit = word.length <= 5 ? 1 : 2;
  let best: string | null = null;
  let bestDistance = limit + 1;
  let bestCount = 0;
  for (const [candidate, count] of vocabulary) {
    if (Math.abs(candidate.length - word.length) > limit) continue;
    const distance = editDistance(word, candidate, bestDistance);
    if (distance < bestDistance || (distance === bestDistance && count > bestCount)) {
      best = candidate;
      bestDistance = distance;
      bestCount = count;
    }
  }
  return bestDistance <= limit ? best : null;
}

/** Optimal string alignment distance, giving up (returning `stop`) once it can't be under `stop`. */
function editDistance(a: string, b: string, stop: number): number {
  let previous2: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, previous2[j - 2] + 1);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin >= stop) return stop;
    previous2 = previous;
    previous = current;
  }
  return Math.min(previous[b.length], stop);
}

/* ------------------------------ search text ------------------------------ */

/**
 * Field objects get a small id so a search corpus can be cached per set of
 * fields: resizing or reordering columns keeps the field objects (and the
 * cache); new metadata (renamed options) brings new ones.
 */
const fieldIds = new WeakMap<FieldMetadata, number>();
let nextFieldId = 0;
/** A record's folded search text, and the same without separators once a reference-like word needs it. */
type SearchCorpus = { text: string; compact?: string };
const searchTextCaches = new Map<string, WeakMap<object, SearchCorpus>>();
const SEARCH_CACHE_LIMIT = 16;

function fieldsSignature(fields: FieldMetadata[]) {
  return fields
    .map((field) => {
      let id = fieldIds.get(field);
      if (id === undefined) {
        id = nextFieldId += 1;
        fieldIds.set(field, id);
      }
      return id;
    })
    .join(",");
}

/**
 * Builds the search text of `records` ahead of the first search, a few
 * milliseconds at a time, so the first letter typed over a long table
 * doesn't wait for every record's text. Returns a function that stops it.
 */
export function prepareRecordSearch(records: readonly object[], fields: FieldMetadata[]): () => void {
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const step = () => {
    const until = performance.now() + 8;
    while (index < records.length && performance.now() < until) {
      for (const stop = Math.min(records.length, index + 100); index < stop; index += 1) {
        searchCorpus(records[index] as FilterableRecord, fields);
      }
    }
    timer = index < records.length ? setTimeout(step, 0) : null;
  };
  timer = setTimeout(step, 0);
  return () => { if (timer !== null) clearTimeout(timer); };
}

/**
 * What the quick search looks in, folded (foldSearchText): every field as its
 * cell reads (option labels and relation names, not stored keys or ids),
 * stored option keys as well, and an adapter's `_searchText`. Built once per
 * record object; an edited record is a new object and gets a fresh entry.
 */
function searchCorpus(record: FilterableRecord, fields: FieldMetadata[]): SearchCorpus {
  const signature = fieldsSignature(fields);
  let cache = searchTextCaches.get(signature);
  if (!cache) {
    if (searchTextCaches.size >= SEARCH_CACHE_LIMIT) {
      const oldest = searchTextCaches.keys().next().value;
      if (oldest !== undefined) searchTextCaches.delete(oldest);
    }
    cache = new WeakMap();
    searchTextCaches.set(signature, cache);
  }
  const cached = cache.get(record);
  if (cached !== undefined) return cached;
  const parts: string[] = [];
  // Adapters can opt into a richer search corpus for display-only joins or
  // fields that are not columns in the active view.
  const extra = getSearchableValue(record._searchText, FIELD_TYPES.TEXT);
  if (extra) parts.push(extra);
  for (const field of fields) {
    const value = record[field.name];
    if (isEmptyValue(value)) continue;
    parts.push(recordCellText(field, value, record));
    if (field.fieldType === FIELD_TYPES.SELECT || field.fieldType === FIELD_TYPES.MULTI_SELECT) {
      parts.push(getSearchableValue(value, field.fieldType));
    }
  }
  const corpus: SearchCorpus = { text: foldSearchText(parts.join("\n")) };
  cache.set(record, corpus);
  return corpus;
}

/* -------------------------------- filters -------------------------------- */

const matchAll: RecordPredicate = () => true;

/**
 * One condition as a predicate. Everything that does not depend on the
 * record (the date range, lower-cased text, option keys a typed label stands
 * for) is worked out here, once.
 */
export function compileRecordFilter(
  column: RecordField | undefined,
  filter: ViewFilter,
  dateContext?: DateRangeContext,
): RecordPredicate {
  if (!column) return matchAll;
  const field = column.field;
  const name = field.name;
  const fieldType = field.fieldType;
  const target = filter.value;

  switch (filter.operator) {
    case "isEmpty":
      return (record) => isEmptyValue(record[name]);
    case "isNotEmpty":
      return (record) => !isEmptyValue(record[name]);
    case "isTrue":
      return (record) => coerceBoolean(record[name]) === true;
    case "isFalse":
      return (record) => coerceBoolean(record[name]) === false;
    case "between": {
      if (!isDateRangeValue(target)) return matchAll;
      const range = resolveDateRange(target, dateContext ?? { today: todayDateOnly() });
      // A range that cannot resolve (e.g. a fiscal preset with no fiscal year
      // end recorded) does not hide records.
      if (!range || (!range.start && !range.end)) return matchAll;
      return (record) => isDateInRange(record[name], range);
    }
    default:
      break;
  }

  if (TEXT_OPERATORS.has(filter.operator)) {
    const expected = String(target ?? "").toLowerCase();
    const texts = (record: FilterableRecord) => matchTexts(field, record);
    switch (filter.operator) {
      case "contains":
        return (record) => texts(record).some((text) => text.includes(expected));
      case "notContains":
        return (record) => !texts(record).some((text) => text.includes(expected));
      case "startsWith":
        return (record) => texts(record).some((text) => text.startsWith(expected));
      default:
        return (record) => texts(record).some((text) => text.endsWith(expected));
    }
  }

  if (filter.operator === "in" || filter.operator === "notIn" || filter.operator === "eq" || filter.operator === "neq") {
    const candidates = Array.isArray(target) ? target : [target];
    const matches = compileEquality(field, candidates);
    return filter.operator === "in" || filter.operator === "eq" ? matches : (record) => !matches(record);
  }

  const compare = (record: FilterableRecord) => {
    const value = record[name];
    // An empty value is neither above nor below anything.
    return isEmptyValue(value) ? null : compareFieldValues(value, target, fieldType);
  };
  switch (filter.operator) {
    case "gt":
      return (record) => (compare(record) ?? 0) > 0;
    case "gte":
      return (record) => { const c = compare(record); return c !== null && c >= 0; };
    case "lt":
      return (record) => (compare(record) ?? 0) < 0;
    case "lte":
      return (record) => { const c = compare(record); return c !== null && c <= 0; };
    default:
      return matchAll;
  }
}

/** Lower-cased texts a text condition looks in: what the cell shows, and stored keys for options. */
function matchTexts(field: FieldMetadata, record: FilterableRecord): string[] {
  const value = record[field.name];
  if (field.fieldType === FIELD_TYPES.RELATION) {
    // A relation stores ids; text conditions match its display label.
    const label = record[`${field.name}Label`];
    return [getSearchableValue(label ?? value, field.fieldType).toLowerCase()];
  }
  if (field.fieldType === FIELD_TYPES.SELECT || field.fieldType === FIELD_TYPES.MULTI_SELECT) {
    if (isEmptyValue(value)) return [""];
    return [recordCellText(field, value, record).toLowerCase(), getSearchableValue(value, field.fieldType).toLowerCase()];
  }
  return [getSearchableValue(value, field.fieldType).toLowerCase()];
}

/**
 * "is" / "is any of". Options match by key or by label (a header filter
 * types the label), relations by id or display name, text-like fields by
 * their text regardless of case; numbers, dates and the rest compare by
 * type.
 */
function compileEquality(field: FieldMetadata, candidates: unknown[]): RecordPredicate {
  const name = field.name;
  const fieldType = field.fieldType;
  const options = Array.isArray(field.config?.options) ? (field.config.options as SelectOption[]) : [];

  if (options.length > 0) {
    const byLabel = new Map(options.map((option) => [String(option.label ?? option.value).toLowerCase(), String(option.value)]));
    const keys = new Set(
      candidates.map((candidate) => {
        const text = String(candidate ?? "");
        return options.some((option) => String(option.value) === text) ? text : byLabel.get(text.toLowerCase()) ?? text;
      }),
    );
    return (record) => {
      const value = record[name];
      return Array.isArray(value) ? value.some((entry) => keys.has(String(entry))) : keys.has(String(value ?? ""));
    };
  }

  if (fieldType === FIELD_TYPES.RELATION) {
    const labels = new Set(candidates.map((candidate) => getSearchableValue(candidate, fieldType).toLowerCase()));
    return (record) => {
      const value = record[name];
      if (candidates.some((candidate) => valuesEqual(value, candidate, fieldType))) return true;
      const label = record[`${name}Label`];
      return label != null && labels.has(String(label).toLowerCase());
    };
  }

  if (TEXT_EQUALITY_TYPES.has(fieldType)) {
    const wanted = new Set(candidates.map((candidate) => getSearchableValue(candidate, fieldType).trim().toLowerCase()));
    return (record) => {
      const value = record[name];
      if (Array.isArray(value)) return value.some((entry) => wanted.has(getSearchableValue(entry, fieldType).trim().toLowerCase()));
      return wanted.has(getSearchableValue(value, fieldType).trim().toLowerCase());
    };
  }

  return (record) => candidates.some((candidate) => valuesEqual(record[name], candidate, fieldType));
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function getSearchableValue(value: unknown, fieldType: FieldType): string {
  if (isEmptyValue(value)) return "";
  if (Array.isArray(value)) {
    return value.map((item) => getSearchableValue(item, fieldType)).join(" ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.label ?? record.name ?? record.title ?? record._id ?? record.id ?? "");
  }
  return String(value);
}

export function compareFieldValues(a: unknown, b: unknown, fieldType: FieldType): number {
  if (isEmptyValue(a) && isEmptyValue(b)) return 0;
  if (isEmptyValue(a)) return -1;
  if (isEmptyValue(b)) return 1;

  if (
    fieldType === FIELD_TYPES.NUMBER ||
    fieldType === FIELD_TYPES.CURRENCY ||
    fieldType === FIELD_TYPES.RATING
  ) {
    return Number(a) - Number(b);
  }

  if (fieldType === FIELD_TYPES.DATE || fieldType === FIELD_TYPES.DATE_TIME) {
    const aTime = Date.parse(String(a));
    const bTime = Date.parse(String(b));
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
  }

  const aBool = coerceBoolean(a);
  const bBool = coerceBoolean(b);
  if (typeof aBool === "boolean" && typeof bBool === "boolean") {
    return aBool === bBool ? 0 : aBool ? 1 : -1;
  }

  return textCollator.compare(getSearchableValue(a, fieldType), getSearchableValue(b, fieldType));
}

const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function valuesEqual(a: unknown, b: unknown, fieldType: FieldType): boolean {
  if (Array.isArray(a)) return a.some((item) => valuesEqual(item, b, fieldType));
  if (Array.isArray(b)) return b.some((item) => valuesEqual(a, item, fieldType));
  return compareFieldValues(a, b, fieldType) === 0;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return undefined;
}
