/**
 * Parse a date typed by hand into a date-only ISO string ("YYYY-MM-DD").
 *
 * Accepts the unambiguous forms people type for records dated years back:
 *   2012-03-04 · 2012/3/4 · 2012.03.04 · 20120304
 *   4 March 2012 · 4 Mar 2012 · March 4, 2012 · Mar 4 2012
 * Day/month-first numeric forms (03/04/2012) are rejected as ambiguous.
 * Returns an error message instead of guessing when the text is not a real
 * calendar date or falls outside [min, max].
 */
export type TypedDateResult = { ok: true; value: string } | { ok: false; error: string };

const MONTH_NAMES = [
  ["january", "janvier", "jan", "janv"],
  ["february", "fevrier", "février", "feb", "fev", "fév", "févr"],
  ["march", "mars", "mar"],
  ["april", "avril", "apr", "avr"],
  ["may", "mai"],
  ["june", "juin", "jun"],
  ["july", "juillet", "jul", "juil"],
  ["august", "aout", "août", "aug"],
  ["september", "septembre", "sep", "sept"],
  ["october", "octobre", "oct"],
  ["november", "novembre", "nov"],
  ["december", "decembre", "décembre", "dec", "déc"],
];

function monthFromName(name: string): number | null {
  const key = name.toLowerCase().replace(/\.$/, "");
  const index = MONTH_NAMES.findIndex((names) => names.includes(key));
  return index >= 0 ? index + 1 : null;
}

function iso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const TYPED_DATE_HINT = "YYYY-MM-DD or 4 March 2012";

export function parseTypedDate(text: string, bounds: { min?: string; max?: string } = {}): TypedDateResult {
  const raw = text.trim().replace(/\s+/g, " ");
  if (!raw) return { ok: false, error: `Type a date as ${TYPED_DATE_HINT}.` };
  let value: string | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw))) {
    value = iso(Number(match[1]), Number(match[2]), Number(match[3]));
  } else if ((match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw))) {
    value = iso(Number(match[1]), Number(match[2]), Number(match[3]));
  } else if ((match = /^(\d{1,2})(?:er)? ([\p{L}.]+),? (\d{4})$/u.exec(raw))) {
    const month = monthFromName(match[2]);
    value = month ? iso(Number(match[3]), month, Number(match[1])) : null;
  } else if ((match = /^([\p{L}.]+) (\d{1,2}),? (\d{4})$/u.exec(raw))) {
    const month = monthFromName(match[1]);
    value = month ? iso(Number(match[3]), month, Number(match[2])) : null;
  } else if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(raw)) {
    return { ok: false, error: "Day/month order is ambiguous. Type the year first (2012-03-04) or the month name (4 March 2012)." };
  }
  if (!value) return { ok: false, error: `"${raw}" is not a calendar date. Use ${TYPED_DATE_HINT}.` };
  if (bounds.min && value < bounds.min) return { ok: false, error: `The date must be on or after ${bounds.min}.` };
  if (bounds.max && value > bounds.max) return { ok: false, error: `The date must be on or before ${bounds.max}.` };
  return { ok: true, value };
}
