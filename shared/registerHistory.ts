/**
 * Point-in-time ("as of") reconstruction of an INTERVAL-based register.
 *
 * The existing roleHolders model records tenure as a `startDate`/`endDate`
 * interval (NOT the supersede/bitemporal model in versionedRegister.ts). This
 * module answers "who were the directors/members on date X?" with zero schema
 * change, purely by filtering rows on their interval bounds.
 *
 * Dates are ISO-8601 strings, which sort lexicographically, so plain string
 * comparison is sufficient. All functions are pure (no convex/react imports)
 * and take any "now" instant as an explicit parameter.
 */

export interface IntervalRow {
  startDate?: string | null;
  endDate?: string | null;
  [k: string]: unknown;
}

export interface AsOfOptions {
  /** Field name holding the interval start. Default `startDate`. */
  start?: string;
  /** Field name holding the interval end. Default `endDate`. */
  end?: string;
}

const DEFAULT_START_FIELD = "startDate";
const DEFAULT_END_FIELD = "endDate";

function startField(opts?: AsOfOptions): string {
  return opts?.start ?? DEFAULT_START_FIELD;
}

function endField(opts?: AsOfOptions): string {
  return opts?.end ?? DEFAULT_END_FIELD;
}

/** Normalize a raw field value to a non-empty ISO string, or null. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Rows active at `asOfISO`: start has occurred (`start <= asOf`, or start is
 * missing/empty → treated as always-started) AND the row has not yet ended
 * (`end` is null/empty OR `end > asOf`).
 *
 * Boundary semantics: present at the exact start, absent at the exact end.
 */
export function activeAsOf<T extends IntervalRow>(
  rows: T[],
  asOfISO: string,
  opts?: AsOfOptions,
): T[] {
  const startKey = startField(opts);
  const endKey = endField(opts);
  return rows.filter((row) => {
    const start = isoOrNull(row[startKey]);
    const end = isoOrNull(row[endKey]);
    const started = start == null || start <= asOfISO;
    const notEnded = end == null || end > asOfISO;
    return started && notEnded;
  });
}

/**
 * Convenience wrapper for the present moment. Purity is preserved by requiring
 * the caller to pass the current instant (`nowISO`) explicitly.
 */
export function activeNow<T extends IntervalRow>(
  rows: T[],
  nowISO: string,
  opts?: AsOfOptions,
): T[] {
  return activeAsOf(rows, nowISO, opts);
}

/**
 * Rows of a given `roleType` that were active at `asOfISO`. The role is matched
 * against a `roleType` field on each row, then the interval filter is applied.
 */
export function roleHoldersAsOf<T extends IntervalRow & { roleType?: unknown }>(
  rows: T[],
  asOfISO: string,
  roleType: string,
  opts?: AsOfOptions,
): T[] {
  const matching = rows.filter((row) => row.roleType === roleType);
  return activeAsOf(matching, asOfISO, opts);
}

/**
 * Whole days of tenure between start and end.
 *
 * Returns null when the start is missing (no anchor to measure from) or when
 * the end is omitted (open/ongoing tenure — span is not yet determined).
 */
export function tenureSpanDays<T extends IntervalRow>(
  row: T,
  opts?: AsOfOptions,
): number | null {
  const start = isoOrNull(row[startField(opts)]);
  const end = isoOrNull(row[endField(opts)]);
  if (start == null || end == null) {
    return null;
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((endMs - startMs) / MS_PER_DAY);
}
