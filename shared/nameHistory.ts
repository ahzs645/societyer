/**
 * Effective-dated corporate NAME history.
 *
 * A society/corporation can carry multiple legal names over its lifetime
 * (YCN DB_GLOB_CORP_NAME: CORP_NAME + SHORT_NAME + START_DT_TM). Each name
 * takes effect on its `startISO` and remains in effect until superseded by the
 * next-starting name. Each name may define its own short ("also known as")
 * term.
 *
 * Dates are ISO-8601 strings, which sort lexicographically, so plain string
 * comparison is sufficient. All functions are pure (no convex/react imports)
 * and take any "now" instant as an explicit parameter.
 */

export interface NameRecord {
  name: string;
  shortName?: string;
  startISO: string;
  regPosn?: number;
}

/**
 * The name in effect at `asOfISO`: the latest record whose `startISO <= asOf`.
 * Returns null when there are no records or none have started yet.
 *
 * Boundary semantics: a name is in effect at the exact instant of its
 * `startISO`.
 */
export function nameAsOf(records: NameRecord[], asOfISO: string): NameRecord | null {
  let chosen: NameRecord | null = null;
  for (const record of records) {
    if (record.startISO > asOfISO) {
      continue;
    }
    if (chosen == null || isLaterStart(record, chosen)) {
      chosen = record;
    }
  }
  return chosen;
}

/**
 * Convenience wrapper for the present moment. Purity is preserved by requiring
 * the caller to pass the current instant (`nowISO`) explicitly.
 */
export function currentName(records: NameRecord[], nowISO: string): NameRecord | null {
  return nameAsOf(records, nowISO);
}

/**
 * Records sorted by `startISO` ascending, tie-broken by `regPosn` ascending
 * (records without a `regPosn` sort after those with one at the same start).
 */
export function nameTimeline(records: NameRecord[]): NameRecord[] {
  return [...records].sort((left, right) => {
    if (left.startISO !== right.startISO) {
      return left.startISO < right.startISO ? -1 : 1;
    }
    return regPosnValue(left) - regPosnValue(right);
  });
}

/**
 * Human-readable summary of a name change history. Returns the empty string
 * when there are zero or one names (nothing to narrate).
 *
 * Example: "Formerly 'YCN Software Inc.' (from 2000-08-08); changed to
 * 'YCN Software International Inc.' on 2008-08-08."
 */
export function nameChangeNarrative(records: NameRecord[]): string {
  const timeline = nameTimeline(records);
  if (timeline.length < 2) {
    return "";
  }
  const original = timeline[0];
  const clauses: string[] = [
    `Formerly '${original.name}' (from ${original.startISO})`,
  ];
  for (let index = 1; index < timeline.length; index += 1) {
    const record = timeline[index];
    const verb = index === timeline.length - 1 ? "changed to" : "renamed to";
    clauses.push(`${verb} '${record.name}' on ${record.startISO}`);
  }
  return `${clauses.join("; ")}.`;
}

function isLaterStart(candidate: NameRecord, incumbent: NameRecord): boolean {
  if (candidate.startISO !== incumbent.startISO) {
    return candidate.startISO > incumbent.startISO;
  }
  return regPosnValue(candidate) >= regPosnValue(incumbent);
}

function regPosnValue(record: NameRecord): number {
  return typeof record.regPosn === "number" && Number.isFinite(record.regPosn)
    ? record.regPosn
    : Number.POSITIVE_INFINITY;
}
