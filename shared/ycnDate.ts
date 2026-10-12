/**
 * YCN/Access FLOAT-DATE CODEC (pure logic, import-boundary use only).
 *
 * YCN stores timestamps as a number of the form YYYYMMDD.HHMMSS, e.g.
 *   20161213.155505 -> 2016-12-13 15:55:05
 *   20200714.09     -> 2020-07-14 09:00:00
 *
 * Values whose date part is < 19000101 (e.g. the sentinel ~18991230) mean
 * "no value / not superseded".
 *
 * Parsing is done by STRING-SLICING the integer/fraction digits rather than
 * float arithmetic, to avoid binary-float drift (e.g. .155505 must not become
 * .155504).
 */

const NULL_DATE_THRESHOLD = 19000101;

function rawToString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    // Avoid exponential / float-drift representations: render with full
    // fractional precision then strip trailing zeros.
    let s = value.toFixed(6);
    if (s.includes(".")) {
      s = s.replace(/0+$/, "").replace(/\.$/, "");
    }
    return s;
  }
  return null;
}

/**
 * Returns the integer (date) part of a YCN raw value, or null when missing.
 */
function datePartNumber(value: number | string | null | undefined): number | null {
  const s = rawToString(value);
  if (s === null) {
    return null;
  }
  const intPart = s.split(".")[0];
  const n = Number.parseInt(intPart, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * true when the value is missing/empty or its date part is < 19000101.
 */
export function isYcnNullDate(value: number | string | null | undefined): boolean {
  const dp = datePartNumber(value);
  if (dp === null) {
    return true;
  }
  return dp < NULL_DATE_THRESHOLD;
}

/**
 * Decode a YCN float-date into ISO-8601 'YYYY-MM-DDTHH:MM:SS', or null.
 *
 * Parsing uses string slicing on the integer/fraction digits to avoid
 * binary-float drift.
 */
export function decodeYcnDate(value: number | string | null | undefined): string | null {
  const s = rawToString(value);
  if (s === null) {
    return null;
  }

  const [intPartRaw, fracPartRaw = ""] = s.split(".");
  const dateDigits = intPartRaw;
  const dateNum = Number.parseInt(dateDigits, 10);
  if (Number.isNaN(dateNum) || dateNum < NULL_DATE_THRESHOLD) {
    return null;
  }

  // Date part: YYYYMMDD (string-sliced).
  if (dateDigits.length !== 8) {
    return null;
  }
  const year = dateDigits.slice(0, 4);
  const month = dateDigits.slice(4, 6);
  const day = dateDigits.slice(6, 8);

  // Time part: pad the fractional digits to 6 (HHMMSS) on the RIGHT.
  const timeDigits = (fracPartRaw + "000000").slice(0, 6);
  const hour = timeDigits.slice(0, 2);
  const minute = timeDigits.slice(2, 4);
  const second = timeDigits.slice(4, 6);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Encode an ISO-8601 date(-time) string into a YCN YYYYMMDD.HHMMSS number,
 * or null. Separators are dropped.
 */
export function encodeYcnDate(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) {
    return null;
  }
  const trimmed = iso.trim();
  if (trimmed === "") {
    return null;
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const datePart = `${year}${month}${day}`;
  const timePart = `${hour}${minute}${second}`;

  // Build the numeric string YYYYMMDD.HHMMSS, then parse to a number.
  const numericString = `${datePart}.${timePart}`;
  const n = Number.parseFloat(numericString);
  return Number.isNaN(n) ? null : n;
}

/**
 * YCN writes `29991231` (or any date in the year 2999 or later) into an end
 * column to mean "no end" — an open interval. Treat it as no end date rather
 * than importing a literal 2999 date.
 */
const OPEN_END_THRESHOLD = 29990101;

/** true when the value is the YCN "open-ended" sentinel (year 2999 or later). */
export function isYcnOpenEndDate(value: number | string | null | undefined): boolean {
  const dp = datePartNumber(value);
  return dp !== null && dp >= OPEN_END_THRESHOLD;
}

/** Result of reading a two-digit year in a birth date. */
export interface ResolvedBirthYear {
  year: number;
  /** Both centuries were plausible and the choice needs a person to confirm it. */
  ambiguous: boolean;
  reason: string;
}

/**
 * Resolve the two-digit year of a BIRTH date ("02/17/20" from an Access export
 * without a 4-digit year format) to a four-digit year.
 *
 * Rules, in order:
 *  - a birth year can't be after the reference year (the export or import year);
 *  - a living person is assumed to be at most `maxAgeYears` old (default 110);
 *  - when the record says the person has reached the age of majority, they must
 *    be at least `majorityAge` years old (default 19, the BC age of majority);
 *    when it says they have not, they must be younger than that.
 * If exactly one century satisfies these rules it is used. If both do, the
 * earlier century is chosen (corporate records are mostly about adults) and the
 * result is flagged `ambiguous` so a reviewer confirms it. If neither does, the
 * later century is used and flagged.
 */
export function resolveTwoDigitBirthYear(
  twoDigitYear: number,
  options: { referenceYear: number; atAgeOfMajority?: boolean; majorityAge?: number; maxAgeYears?: number },
): ResolvedBirthYear {
  const yy = ((Math.trunc(twoDigitYear) % 100) + 100) % 100;
  const majorityAge = options.majorityAge ?? 19;
  const maxAge = options.maxAgeYears ?? 110;
  const ref = options.referenceYear;
  const plausible = (year: number) => {
    if (year > ref || ref - year > maxAge) return false;
    if (options.atAgeOfMajority === true && ref - year < majorityAge) return false;
    if (options.atAgeOfMajority === false && ref - year >= majorityAge) return false;
    return true;
  };
  const candidates = [1900 + yy, 2000 + yy].filter(plausible);
  if (candidates.length === 1) {
    return { year: candidates[0], ambiguous: false, reason: `two-digit year ${String(yy).padStart(2, "0")} read as ${candidates[0]}` };
  }
  if (candidates.length === 2) {
    return {
      year: candidates[0],
      ambiguous: true,
      reason: `two-digit year ${String(yy).padStart(2, "0")} could be ${candidates[0]} or ${candidates[1]}; ${candidates[0]} assumed, confirm the birth date`,
    };
  }
  return {
    year: 2000 + yy > ref ? 1900 + yy : 2000 + yy,
    ambiguous: true,
    reason: `two-digit year ${String(yy).padStart(2, "0")} does not fit the age-of-majority flag; confirm the birth date`,
  };
}
