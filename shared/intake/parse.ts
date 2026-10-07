/** Deterministic date, time and money parsing for intake (stages 5–6).
 * Nothing is defaulted: an unparseable value stays absent, never "today" or noon. */

export type DateMatch = { iso: string; precision: "day" | "month" | "year"; text: string; index: number; length: number };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

export function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

export function validIsoDay(year: number, month: number, day: number): string | undefined {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : undefined;
}

function expandYear(value: string): number {
  const year = Number(value);
  if (value.length === 4) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

/** All explicit dates in running text, in source order, de-overlapped. */
export function findDates(raw: string, options: { allowMonthPrecision?: boolean; allowNumericShortYear?: boolean } = {}): DateMatch[] {
  // Underscores separate words in file names; same-length replacement keeps offsets.
  const text = raw.replace(/_/g, " ");
  const found: DateMatch[] = [];
  const push = (iso: string | undefined, precision: DateMatch["precision"], index: number, length: number) => {
    if (!iso) return;
    if (found.some((existing) => index < existing.index + existing.length && existing.index < index + length)) return;
    found.push({ iso, precision, text: raw.slice(index, index + length), index, length });
  };
  // Weekday, Month Day(st), Year | Month Day Year
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\.?(?:\\s*,?\\s*|-)(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,\\s*|\\s+|,|-)(?:\\d{4}\\s*,\\s*)?((?:19|20)\\d{2})\\b`, "gi"))) {
    push(validIsoDay(Number(m[3]), monthIndex(m[1]), Number(m[2])), "day", m.index!, m[0].length);
  }
  // Day Month Year (28 November 2018, 23-Feb-2016)
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${MONTH_RE}\\.?[\\s,-]+((?:19|20)\\d{2})\\b`, "gi"))) {
    push(validIsoDay(Number(m[3]), monthIndex(m[2]), Number(m[1])), "day", m.index!, m[0].length);
  }
  // ISO-ish 2019-02-19, 2019_05_28, 2019/02/19, 2019.02.19
  for (const m of raw.matchAll(/(?<!\d)((?:19|20)\d{2})[-_/.](\d{1,2})[-_/.](\d{1,2})(?!\d)/g)) {
    push(validIsoDay(Number(m[1]), Number(m[2]), Number(m[3])), "day", m.index!, m[0].length);
  }
  // dd_mm_yyyy or dd-mm-yyyy (only when unambiguous: day > 12 or explicit separators "_")
  for (const m of raw.matchAll(/(?<!\d)(\d{1,2})[-_/.](\d{1,2})[-_/.]((?:19|20)\d{2})(?!\d)/g)) {
    const a = Number(m[1]), b = Number(m[2]);
    // North American documents write mm/dd/yyyy; prefer day-first only when the first part cannot be a month.
    const iso = a > 12 ? validIsoDay(Number(m[3]), b, a) : b > 12 ? validIsoDay(Number(m[3]), a, b) : undefined;
    push(iso, "day", m.index!, m[0].length);
  }
  if (options.allowNumericShortYear) {
    // yy-mm-dd (legacy filename convention "08-10-28 - Minutes")
    for (const m of raw.matchAll(/(?<!\d)(\d{2})[-_.](\d{2})[-_.](\d{2})(?!\d)/g)) {
      push(validIsoDay(expandYear(m[1]), Number(m[2]), Number(m[3])), "day", m.index!, m[0].length);
    }
  }
  if (options.allowMonthPrecision) {
    for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\.?,?\\s+((?:19|20)\\d{2})\\b`, "gi"))) {
      const month = monthIndex(m[1]);
      if (month) push(`${m[2]}-${String(month).padStart(2, "0")}`, "month", m.index!, m[0].length);
    }
    for (const m of text.matchAll(/(?<![\d-])((?:19|20)\d{2})(?![\d-])/g)) push(m[1], "year", m.index!, m[0].length);
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Month Day without a year, resolved against a reference date (e.g. "November 17" in 2016 minutes). */
export function findDatesWithoutYear(text: string, referenceIso: string): DateMatch[] {
  const refYear = Number(referenceIso.slice(0, 4));
  const out: DateMatch[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*(?:19|20)\\d{2})`, "gi"))) {
    const month = monthIndex(m[1]);
    const iso = validIsoDay(refYear, month, Number(m[2]));
    if (iso) out.push({ iso, precision: "day", text: m[0], index: m.index!, length: m[0].length });
  }
  return out;
}

function to24(hour: number, minute: number, meridiem?: string): string | undefined {
  if (minute > 59 || hour > 23) return undefined;
  let h = hour;
  const mer = meridiem?.toLowerCase().replace(/\./g, "");
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (mer && hour > 12) return undefined;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const TIME_TOKEN = String.raw`(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon)?`;

/** Business-hours guess for a time written without am/pm (1–6 → pm, 7–11 → am). */
function guessMeridiem(hour: number): "am" | "pm" | undefined {
  if (hour >= 13 || hour === 0) return undefined;
  if (hour === 12) return "pm";
  return hour <= 6 ? "pm" : "am";
}

export type TimeRange = { start?: string; end?: string; text: string; index: number; inferredMeridiem: boolean };

/** "5:30 – 8:00pm", "(6:00 PM – 7:00 PM)", "12:00-1:30 PM", "5:00 PM to 7:00 PM". */
export function findTimeRange(text: string): TimeRange | undefined {
  const re = new RegExp(`${TIME_TOKEN}\\s*(?:[-–—]|to|until)\\s*${TIME_TOKEN}`, "i");
  for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
    const [whole, h1, m1, mer1, h2, m2, mer2] = m;
    if (!m1 && !m2 && !mer1 && !mer2) continue; // "2019-2020", "1-2"
    if (/^\d{4}/.test(whole) && !m1) continue;
    let startMer: string | undefined = mer1?.toLowerCase().startsWith("noon") ? "pm" : mer1;
    let endMer: string | undefined = mer2?.toLowerCase().startsWith("noon") ? "pm" : mer2;
    let inferred = false;
    const sh = Number(h1), eh = Number(h2);
    if (!startMer && endMer) {
      // "11:30 – 1:00 PM" crosses noon; otherwise share the end meridiem.
      const endIsPm = /^p/i.test(endMer);
      startMer = endIsPm && sh !== 12 && sh > eh ? "am" : endMer;
    }
    if (!startMer && !endMer && sh <= 12 && eh <= 12) {
      startMer = guessMeridiem(sh);
      endMer = guessMeridiem(eh) ?? startMer;
      if (sh === 12 && eh < 12) endMer = "pm";
      inferred = true;
    }
    if (startMer && !endMer) endMer = sh < 12 && /^a/i.test(startMer) && eh < sh ? "pm" : startMer;
    const start = to24(sh, Number(m1 ?? 0), startMer);
    const end = to24(eh, Number(m2 ?? 0), endMer);
    if (start && end) return { start, end, text: whole, index: m.index!, inferredMeridiem: inferred };
  }
  return undefined;
}

/** Single time: "5:05PM", "6:40pm", "13:34", "12:07 pm", "1206" (24h compact, only with a context word). */
export function parseTime(text: string, options: { compact?: boolean } = {}): { time: string; text: string; index: number; inferredMeridiem: boolean } | undefined {
  const candidates: Array<{ time: string; text: string; index: number; inferredMeridiem: boolean }> = [];
  for (const match of text.matchAll(new RegExp(`(?<![\\d:/$.,-])(\\d{1,2})[:.](\\d{2})\\s*(a\\.?m\\.?|p\\.?m\\.?)?(?![\\d%])`, "gi"))) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const mer = match[3] ?? (hour <= 12 ? guessMeridiem(hour) : undefined);
    const time = to24(hour, minute, mer);
    if (time) candidates.push({ time, text: match[0], index: match.index!, inferredMeridiem: !match[3] && hour <= 12 });
  }
  for (const match of text.matchAll(/(?<![\d:])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi)) {
    const time = to24(Number(match[1]), 0, match[2]);
    if (time) candidates.push({ time, text: match[0], index: match.index!, inferredMeridiem: false });
  }
  if (options.compact) {
    for (const match of text.matchAll(/(?<![\d:$])([01]\d|2[0-3])([0-5]\d)(?![\d%])(?:\s*(?:h|hrs|hours))?/g)) {
      candidates.push({ time: `${match[1]}:${match[2]}`, text: match[0], index: match.index!, inferredMeridiem: false });
    }
  }
  return candidates.sort((a, b) => a.index - b.index)[0];
}

export type MoneyMatch = { amountCents: number; currency: string; text: string; index: number };
export function findMoney(text: string): MoneyMatch[] {
  const out: MoneyMatch[] = [];
  for (const m of text.matchAll(/(?:CAD|C\$|US\$|\$)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|K|thousand|million|M|billion)?\b/g)) {
    const whole = Number(m[1].replace(/,/g, ""));
    const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
    const scale = m[3] ? (/^k|thousand/i.test(m[3]) ? 1_000 : /^m/i.test(m[3]) ? 1_000_000 : 1_000_000_000) : 1;
    out.push({ amountCents: Math.round((whole + cents / 100) * scale * 100), currency: m[0].startsWith("US") ? "USD" : "CAD", text: m[0], index: m.index! });
  }
  return out;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/[\u00a0\u2007\u202f]/g, " ").replace(/\s+/g, " ").trim();
}
