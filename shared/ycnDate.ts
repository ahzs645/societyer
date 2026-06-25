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
