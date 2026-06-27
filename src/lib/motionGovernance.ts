// Pure, framework-free governance logic for motions and their outcomes.
//
// These functions are intentionally kept out of MotionEditor.tsx (which pulls
// in React + icon libraries) so they can be unit-tested with a plain Node
// assertion script (`scripts/check-meeting-governance.ts`) without a DOM or a
// React runtime. MotionEditor re-exports them for backward compatibility.

/** Canonical motion outcome vocabulary. Capitalized, single source of truth.
 *  - Pending  : recorded but not yet voted on
 *  - Carried  : passed
 *  - Defeated : failed
 *  - Tabled   : set aside / postponed within the same meeting
 *  - Deferred : pushed to a later meeting (eligible for the motion backlog) */
export type MotionOutcome = "Pending" | "Carried" | "Defeated" | "Tabled" | "Deferred";

export interface MotionOutcomeMeta {
  id: MotionOutcome;
  label: string;
  /** btn-action tone modifier class, or "" for the neutral/pending tone. */
  toneClass: string;
}

/** Ordered list used to render the outcome picker and to validate values. */
export const MOTION_OUTCOMES: MotionOutcomeMeta[] = [
  { id: "Pending", label: "Pending", toneClass: "" },
  { id: "Carried", label: "Carried", toneClass: "btn-action--success" },
  { id: "Defeated", label: "Defeated", toneClass: "btn-action--danger" },
  { id: "Tabled", label: "Tabled", toneClass: "btn-action--warn" },
  { id: "Deferred", label: "Deferred", toneClass: "btn-action--warn" },
];

/** Outcomes that postpone a motion to a future meeting — these are the ones
 *  eligible to be pushed onto the motion backlog. Case-insensitive so legacy
 *  lowercase data ("tabled"/"deferred") still matches. */
export const POSTPONED_OUTCOMES: MotionOutcome[] = ["Tabled", "Deferred"];

export function isPostponedOutcome(outcome: string | undefined | null): boolean {
  const value = String(outcome ?? "").trim().toLowerCase();
  return POSTPONED_OUTCOMES.some((outcomeId) => outcomeId.toLowerCase() === value);
}

/** Normalize free-form/legacy outcome strings to the canonical capitalized
 *  vocabulary. Unknown values fall through unchanged so we never silently drop
 *  data we didn't anticipate. */
export function normalizeMotionOutcome(outcome: string | undefined | null): string {
  const value = String(outcome ?? "").trim();
  if (!value) return "Pending";
  const match = MOTION_OUTCOMES.find((meta) => meta.id.toLowerCase() === value.toLowerCase());
  return match ? match.id : value;
}

/** The vote fractions (0–1 of votes cast) a society requires for each
 *  resolution type. Stored on the bylaw rule set as percentages; this is the
 *  runtime fractional view the governance helpers compare ratios against.
 *  Kept as fractions (not percentages) so the canonical two-thirds is the
 *  exact `2 / 3` float rather than a `pct / 100` round-trip that loses a ULP. */
export interface ResolutionThresholds {
  /** Fraction of votes cast required for an ordinary resolution (simple majority). */
  ordinary: number;
  /** Fraction required for a special resolution (statutory default: two-thirds). */
  special: number;
  /** Fraction required for a unanimous resolution (1 = everyone). */
  unanimous: number;
}

/** BC Societies Act baselines, used whenever a society has no configured rule
 *  set. `special` is the *exact* two-thirds, not the rounded 66.67 we display. */
export const STATUTORY_RESOLUTION_THRESHOLDS: ResolutionThresholds = {
  ordinary: 0.5,
  special: 2 / 3,
  unanimous: 1,
};

/** Map a society's stored bylaw rule set (threshold percentages) to runtime
 *  fractions. Takes a structural subset so this module stays free of
 *  Convex/`Doc` types and can be unit-tested in plain Node. Missing fields fall
 *  back to the statutory value. */
export function bylawRulesToThresholds(
  rules?: {
    ordinaryResolutionThresholdPct?: number;
    specialResolutionThresholdPct?: number;
  } | null,
): ResolutionThresholds {
  if (!rules) return STATUTORY_RESOLUTION_THRESHOLDS;
  return {
    ordinary:
      rules.ordinaryResolutionThresholdPct != null
        ? rules.ordinaryResolutionThresholdPct / 100
        : STATUTORY_RESOLUTION_THRESHOLDS.ordinary,
    special: normalizeSpecialFraction(rules.specialResolutionThresholdPct),
    unanimous: STATUTORY_RESOLUTION_THRESHOLDS.unanimous,
  };
}

/** The bylaw table stores the special-resolution threshold as a rounded
 *  percentage (66.67). Taken literally that is *stricter* than two-thirds, so
 *  an exact two-thirds vote (0.6666…) would fail. Snap any value within 0.1%
 *  of two-thirds back to the exact `2 / 3` fraction. */
function normalizeSpecialFraction(pct?: number): number {
  if (pct == null) return STATUTORY_RESOLUTION_THRESHOLDS.special;
  const fraction = pct / 100;
  return Math.abs(fraction - 2 / 3) < 0.001 ? 2 / 3 : fraction;
}

/** Required threshold (fraction of votes cast) for a resolution type. Defaults
 *  to the BC Societies Act baselines; pass a society's configured thresholds to
 *  honour its bylaws (ordinary = simple majority, special = 2/3, unanimous =
 *  all, unless the society set different percentages). */
export function thresholdFor(
  kind?: string,
  thresholds: ResolutionThresholds = STATUTORY_RESOLUTION_THRESHOLDS,
): number {
  if (kind === "Special") return thresholds.special;
  if (kind === "Unanimous") return thresholds.unanimous;
  return thresholds.ordinary;
}

/** Whether a motion's vote counts meet its resolution threshold. Abstentions
 *  do not count toward "votes cast". Returns null when no votes were recorded
 *  (so callers can distinguish "no data" from "failed").
 *
 *  An ordinary motion needs a *simple majority* — strictly more than half of
 *  the votes cast — so a tie is lost. Super-majorities (Special = 2/3,
 *  Unanimous) carry when the threshold is met exactly. */
export function motionMeetsThreshold(
  m: {
    votesFor?: number;
    votesAgainst?: number;
    resolutionType?: string;
  },
  thresholds: ResolutionThresholds = STATUTORY_RESOLUTION_THRESHOLDS,
): boolean | null {
  const votesFor = m.votesFor ?? 0;
  const votesAgainst = m.votesAgainst ?? 0;
  const cast = votesFor + votesAgainst; // abstentions don't count toward "votes cast"
  if (cast === 0) return null;
  const ratio = votesFor / cast;
  const threshold = thresholdFor(m.resolutionType, thresholds);
  // A simple majority needs *more* than half (a tie loses); any super-majority
  // carries when the threshold is met exactly.
  return threshold === 0.5 ? ratio > 0.5 : ratio >= threshold;
}

/** Heuristic: does this motion represent adjourning the meeting? Adjournment
 *  is recorded as a procedural motion and handled separately in the UI. */
export function isAdjournmentMotion(motion: {
  text?: string;
  sectionTitle?: string;
  resolutionType?: string;
}): boolean {
  const text = `${motion.text ?? ""} ${motion.sectionTitle ?? ""} ${motion.resolutionType ?? ""}`.toLowerCase();
  return /\badjourn(?:ment|ed|s)?\b/.test(text);
}
