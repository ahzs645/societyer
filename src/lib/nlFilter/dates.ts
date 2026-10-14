import {
  addDays,
  describeDateRange,
  fiscalYearBounds,
  resolveDateRange,
  type DateRangePresetId,
  type DateRangeValue,
} from "../dateRanges";
import type { NlContext } from "./types";

/**
 * Date phrases → `DateRangeValue`. Named periods that `dateRanges.ts` knows
 * ("this month", "last 30 days", "last fiscal year") stay presets so a saved
 * view keeps meaning "relative to today"; other periods become explicit dates.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_SOURCE = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const ORDINAL = String.raw`(?:st|nd|rd|th)?`;

/** One date expression (no leading preposition). */
export const DATE_EXPR_SOURCE = [
  String.raw`today|yesterday|tomorrow`,
  String.raw`(?:this|last|next|past|previous|current|prior)\s+(?:fiscal\s+year|financial\s+year|fy|week|month|quarter|year)`,
  String.raw`(?:last|past|previous|next|the\s+last|the\s+past|the\s+next)\s+\d{1,3}\s+(?:days?|weeks?|months?|years?)`,
  String.raw`(?:year|quarter|month|fiscal\s+year)[\s-]+to[\s-]+date|ytd|qtd|mtd|fytd`,
  String.raw`\d{4}-\d{2}-\d{2}`,
  String.raw`q[1-4](?:\s+(?:of\s+)?(?:fy\s?)?\d{4})?`,
  String.raw`(?:first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter(?:\s+(?:of\s+)?\d{4})?`,
  String.raw`${MONTH_SOURCE}(?:\s+\d{1,2}${ORDINAL}(?![\d,]))?(?:\s+(?:of\s+)?\d{4})?`,
  String.raw`\d{1,2}${ORDINAL}\s+(?:of\s+)?${MONTH_SOURCE}(?:\s+\d{4})?`,
  String.raw`(?:19|20)\d{2}`,
].join("|");

export type ParsedDate = {
  /** A preset, or concrete inclusive bounds. */
  value: DateRangeValue;
  /** Bounds for since/before arithmetic; null when it cannot resolve (no fiscal year end). */
  bounds: { start: string; end: string } | null;
  /** Bare years and month names need a preposition to count. */
  weak: boolean;
  note?: string;
};

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthRange = (year: number, month: number) => ({ start: iso(year, month, 1), end: iso(year, month, lastDay(year, month)) });
const quarterRange = (year: number, quarter: number) => ({ start: iso(year, quarter * 3 - 2, 1), end: iso(year, quarter * 3, lastDay(year, quarter * 3)) });
const yearRange = (year: number) => ({ start: `${year}-01-01`, end: `${year}-12-31` });

function addMonths(isoDate: string, months: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const day = Math.min(d, lastDay(target.getUTCFullYear(), target.getUTCMonth() + 1));
  return iso(target.getUTCFullYear(), target.getUTCMonth() + 1, day);
}

function monthIndex(word: string): number {
  const key = word.slice(0, 3);
  return MONTHS.indexOf(key) + 1;
}

function weekStart(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(today, -((weekday + 6) % 7));
}

function presetValue(preset: DateRangePresetId, context: NlContext, note?: string): ParsedDate {
  const resolved = resolveDateRange({ preset }, { today: context.today, fiscalYearEnd: context.fiscalYearEnd });
  const bounds = resolved && resolved.start && resolved.end ? { start: resolved.start, end: resolved.end } : null;
  return { value: { preset }, bounds, weak: false, note: bounds ? undefined : note };
}

const custom = (bounds: { start: string; end: string }, weak = false): ParsedDate => ({ value: { start: bounds.start, end: bounds.end }, bounds, weak });

/** Parse one date expression matched by `DATE_EXPR_SOURCE`. */
export function parseDateExpression(raw: string, context: NlContext): ParsedDate | null {
  const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const { today } = context;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const noFiscal = "No fiscal year end is recorded, so fiscal periods can't be worked out.";

  if (text === "today") return presetValue("today", context);
  if (text === "yesterday") return custom({ start: addDays(today, -1), end: addDays(today, -1) });
  if (text === "tomorrow") return custom({ start: addDays(today, 1), end: addDays(today, 1) });
  if (/^(ytd|year[\s-]+to[\s-]+date)$/.test(text)) return presetValue("yearToDate", context);
  if (/^(qtd|quarter[\s-]+to[\s-]+date)$/.test(text)) return presetValue("quarterToDate", context);
  if (/^(mtd|month[\s-]+to[\s-]+date)$/.test(text)) return custom({ start: iso(year, month, 1), end: today });
  if (/^(fytd|fiscal year[\s-]+to[\s-]+date)$/.test(text)) return presetValue("fiscalYearToDate", context, noFiscal);

  let match = /^(this|last|next|past|previous|current|prior) (fiscal year|financial year|fy|week|month|quarter|year)$/.exec(text);
  if (match) {
    const offset = match[1] === "next" ? 1 : match[1] === "this" || match[1] === "current" ? 0 : -1;
    const unit = match[2];
    if (unit === "fiscal year" || unit === "financial year" || unit === "fy") {
      if (offset === -1) return presetValue("lastFiscalYear", context, noFiscal);
      const bounds = fiscalYearBounds(today, context.fiscalYearEnd, offset);
      if (!bounds?.start || !bounds.end) return { value: { preset: "fiscalYearToDate" }, bounds: null, weak: false, note: noFiscal };
      return custom({ start: bounds.start, end: bounds.end });
    }
    if (unit === "month") {
      if (offset === 0) return presetValue("thisMonth", context);
      if (offset === -1) return presetValue("lastMonth", context);
      const first = addMonths(iso(year, month, 1), 1);
      return custom(monthRange(Number(first.slice(0, 4)), Number(first.slice(5, 7))));
    }
    if (unit === "week") {
      const start = addDays(weekStart(today), offset * 7);
      return custom({ start, end: addDays(start, 6) });
    }
    if (unit === "quarter") {
      const index = (year * 4 + Math.floor((month - 1) / 3)) + offset;
      return custom(quarterRange(Math.floor(index / 4), (index % 4) + 1));
    }
    return custom(yearRange(year + offset));
  }

  match = /^(?:the )?(last|past|previous|next) (\d{1,3}) (days?|weeks?|months?|years?)$/.exec(text);
  if (match) {
    const count = Number(match[2]);
    if (count < 1) return null;
    const unit = match[3].replace(/s$/, "");
    if (match[1] !== "next") {
      if (unit === "day" && count === 7) return presetValue("last7", context);
      if (unit === "day" && count === 30) return presetValue("last30", context);
      if (unit === "day" && count === 90) return presetValue("last90", context);
      if (unit === "day") return custom({ start: addDays(today, -(count - 1)), end: today });
      if (unit === "week") return custom({ start: addDays(today, -(count * 7 - 1)), end: today });
      if (unit === "month") return custom({ start: addDays(addMonths(today, -count), 1), end: today });
      return custom({ start: addDays(addMonths(today, -count * 12), 1), end: today });
    }
    if (unit === "day") return custom({ start: today, end: addDays(today, count - 1) });
    if (unit === "week") return custom({ start: today, end: addDays(today, count * 7 - 1) });
    if (unit === "month") return custom({ start: today, end: addDays(addMonths(today, count), -1) });
    return custom({ start: today, end: addDays(addMonths(today, count * 12), -1) });
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) return null;
    return custom({ start: text, end: text });
  }

  match = /^q([1-4])(?: (?:of )?(?:fy ?)?(\d{4}))?$/.exec(text);
  if (match) return custom(quarterRange(match[2] ? Number(match[2]) : year, Number(match[1])));

  match = /^(first|second|third|fourth|1st|2nd|3rd|4th) quarter(?: (?:of )?(\d{4}))?$/.exec(text);
  if (match) {
    const quarter = ["first", "second", "third", "fourth"].indexOf(match[1]) + 1 || Number(match[1][0]);
    return custom(quarterRange(match[2] ? Number(match[2]) : year, quarter));
  }

  match = new RegExp(String.raw`^(${MONTH_SOURCE})(?: (\d{1,2})${ORDINAL})?(?: (?:of )?(\d{4}))?$`).exec(text);
  if (match) return monthOrDay(match[1], match[2], match[3], year);

  match = new RegExp(String.raw`^(\d{1,2})${ORDINAL} (?:of )?(${MONTH_SOURCE})(?: (\d{4}))?$`).exec(text);
  if (match) return monthOrDay(match[2], match[1], match[3], year);

  if (/^(19|20)\d{2}$/.test(text)) return custom(yearRange(Number(text)), true);
  return null;
}

function monthOrDay(monthWord: string, dayText: string | undefined, yearText: string | undefined, currentYear: number): ParsedDate | null {
  const m = monthIndex(monthWord);
  if (m < 1) return null;
  const y = yearText ? Number(yearText) : currentYear;
  // "may" and "march" are also ordinary words; alone they need a preposition.
  const weak = !dayText && !yearText && (monthWord === "may" || monthWord === "march" || monthWord === "mar");
  if (dayText) {
    const d = Number(dayText);
    if (d < 1 || d > lastDay(y, m)) return null;
    return custom({ start: iso(y, m, d), end: iso(y, m, d) }, weak);
  }
  return custom(monthRange(y, m), weak);
}

export type DatePrefix = "since" | "after" | "before" | "until" | "in" | "none";

export function prefixKind(word: string | undefined): DatePrefix {
  if (!word) return "none";
  const text = word.replace(/\s+/g, " ").trim();
  if (/^(since|from|starting|starting from|starting on|beginning|as of|on or after)$/.test(text)) return "since";
  if (text === "after") return "after";
  if (/^(before|prior to|earlier than|older than)$/.test(text)) return "before";
  if (/^(until|till|up to|through|by|on or before|no later than)$/.test(text)) return "until";
  return "in";
}

/** Apply since / after / before / until to a parsed period. */
export function applyPrefix(parsed: ParsedDate, prefix: DatePrefix): DateRangeValue | null {
  if (prefix === "in" || prefix === "none") return parsed.value;
  if (!parsed.bounds) return null;
  switch (prefix) {
    case "since":
      return { start: parsed.bounds.start };
    case "after":
      return { start: addDays(parsed.bounds.end, 1) };
    case "before":
      return { end: addDays(parsed.bounds.start, -1) };
    case "until":
      return { end: parsed.bounds.end };
  }
}

/** Chip wording: the phrase as typed ("this year"), with exact dates as detail. */
export function describeParsedDate(phrase: string, value: DateRangeValue): { text: string; detail?: string } {
  const pretty = phrase
    .replace(/\s+/g, " ")
    .trim()
    .replace(new RegExp(`\\b(${MONTH_NAMES.join("|")}|${MONTHS.join("|")}|sept)\\b`, "gi"), (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .replace(/\b(q[1-4]|ytd|qtd|mtd|fytd|fy)\b/gi, (word) => word.toUpperCase());
  const exact = describeDateRange(value);
  if (value.preset && value.preset !== "custom") {
    const same = exact.toLowerCase() === pretty.toLowerCase();
    return { text: same ? exact.charAt(0).toLowerCase() + exact.slice(1) : pretty, detail: same ? undefined : exact };
  }
  return { text: pretty, detail: exact };
}
