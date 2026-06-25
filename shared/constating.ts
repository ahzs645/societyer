/**
 * CONSTATING-DOCUMENT TIMELINE (pure logic).
 *
 * Models the lineage of an organization's constating documents over time
 * (YCN DB_GLOB_CONSTATING: JURISDICTION / LEGISLATION / REG_ACTION /
 * REG_NUMBER / START_DT_TM). An entity is incorporated under some Act, then
 * may be transitioned, continued, amalgamated, or restated — each event placing
 * the entity under a governing Act from a given start date.
 *
 * Dates are ISO-8601 strings, which sort lexicographically, so plain string
 * comparison is sufficient for ordering and as-of queries. All functions are
 * pure (no convex/react imports).
 */

export type ConstatingAction =
  | "incorporated"
  | "transitioned"
  | "continued"
  | "amalgamated"
  | "restated"
  | "other";

export interface ConstatingEvent {
  action: ConstatingAction;
  jurisdiction: string;
  legislation: string;
  regNumber?: string;
  startISO: string;
}

const CONSTATING_ACTIONS: ReadonlySet<ConstatingAction> = new Set<ConstatingAction>([
  "incorporated",
  "transitioned",
  "continued",
  "amalgamated",
  "restated",
  "other",
]);

/** Past-tense verb phrase introducing each action in a narrative. */
const ACTION_PHRASE: Record<ConstatingAction, string> = {
  incorporated: "Incorporated under",
  transitioned: "transitioned to",
  continued: "continued under",
  amalgamated: "amalgamated under",
  restated: "restated under",
  other: "registered under",
};

/** The constating events sorted chronologically by `startISO` (stable). */
export function constatingTimeline(events: ConstatingEvent[]): ConstatingEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      if (left.event.startISO < right.event.startISO) return -1;
      if (left.event.startISO > right.event.startISO) return 1;
      return left.index - right.index;
    })
    .map(({ event }) => event);
}

/**
 * The governing Act as of `asOfISO`: the latest event whose `startISO` is on
 * or before `asOfISO`. Returns null when no event has taken effect yet.
 */
export function currentRegime(events: ConstatingEvent[], asOfISO: string): ConstatingEvent | null {
  const eligible = constatingTimeline(events).filter((event) => event.startISO <= asOfISO);
  return eligible.length === 0 ? null : eligible[eligible.length - 1];
}

/**
 * Human-readable narrative of the constating chain, e.g.:
 * "Incorporated under the Company Act (BC) on 2000-08-08 (No. 808888);
 *  transitioned to the Business Corporations Act (BC) on 2008-08-08 (No. BC0808888)."
 */
export function regimeNarrative(events: ConstatingEvent[]): string {
  const ordered = constatingTimeline(events);
  if (ordered.length === 0) {
    return "";
  }
  const clauses = ordered.map((event) => narrativeClause(event));
  return `${clauses.join("; ")}.`;
}

function narrativeClause(event: ConstatingEvent): string {
  const phrase = ACTION_PHRASE[event.action] ?? ACTION_PHRASE.other;
  let clause = `${phrase} the ${event.legislation} (${event.jurisdiction}) on ${event.startISO}`;
  if (event.regNumber && event.regNumber.trim() !== "") {
    clause += ` (No. ${event.regNumber.trim()})`;
  }
  return clause;
}

/**
 * Validate a single constating event. Requires a recognized action and
 * non-empty jurisdiction, legislation, and startISO.
 */
export function validateConstatingEvent(e: ConstatingEvent): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!e || typeof e !== "object") {
    return { ok: false, errors: ["event must be an object"] };
  }

  if (!CONSTATING_ACTIONS.has(e.action)) {
    errors.push(`action must be one of: ${Array.from(CONSTATING_ACTIONS).join(", ")}`);
  }
  if (!isNonEmptyString(e.jurisdiction)) {
    errors.push("jurisdiction is required");
  }
  if (!isNonEmptyString(e.legislation)) {
    errors.push("legislation is required");
  }
  if (!isNonEmptyString(e.startISO)) {
    errors.push("startISO is required");
  }

  return { ok: errors.length === 0, errors };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
