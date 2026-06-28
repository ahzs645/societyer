// Pure, framework-free governance logic for motions and their outcomes.
//
// These functions are intentionally kept out of MotionEditor.tsx (which pulls
// in React + icon libraries) so they can be unit-tested with a plain Node
// assertion script (`scripts/check-meeting-governance.ts`) without a DOM or a
// React runtime. MotionEditor re-exports them for backward compatibility.

import {
  classifyProceduralMotion,
  isDecidedWithoutVote,
  isRoutineMotion as sharedIsRoutineMotion,
  ROUTINE_MOTION_TAGS as SHARED_ROUTINE_MOTION_TAGS,
  type ClassifiableMotion,
} from "../../shared/proceduralMotions";

// Re-export the shared procedural-motion catalogue + helpers so existing
// importers can keep pulling them from this module (the historical home of the
// governance helpers). The catalogue itself lives in shared/ so the Convex
// dual-write layer can apply the same classification/auto-labeling.
export {
  classifyProceduralMotion,
  defaultDecidedByFor,
  applyProceduralTags,
  isDecidedWithoutVote,
  proceduralKindByKey,
  PROCEDURAL_MOTION_KINDS,
  PROCEDURAL_MOTION_KEYS,
  DECIDED_BY_VALUES,
  DECIDED_BY_LABELS,
  type DecidedBy,
  type ProceduralMotionKind,
  type ParliamentaryClass,
  type ClassifiableMotion,
} from "../../shared/proceduralMotions";

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

// ============================================================================
// Resolution-type catalogue — the society-editable list of resolution types a
// motion can be classified under. The three statutory built-ins (Ordinary /
// Special / Unanimous) are always *derived* from the bylaw threshold
// percentages so they can't drift; only custom types are stored on
// bylawRuleSet.resolutionTypes. This is what the Bylaw Rules editor edits and
// what the motion type dropdown is driven from.
// ============================================================================

export type ResolutionBase = "votesCast" | "eligibleMembers" | "quorum";

export interface ResolutionType {
  id: string;
  label: string;
  builtIn?: boolean;
  /** The denominator the threshold applies to ("number of total people"). */
  base: ResolutionBase;
  thresholdPct: number;
  tieBreak?: "fails" | "chairCasts";
  order?: number;
}

/** Structural subset of a bylaw rule set this module reads. Avoids a dependency
 *  on Convex `Doc` types so the logic stays unit-testable in plain Node. */
export type ResolutionRulesLike = {
  ordinaryResolutionThresholdPct?: number;
  specialResolutionThresholdPct?: number;
  resolutionTypes?: ResolutionType[];
};

/** Selectable bases for the editor. */
export const RESOLUTION_BASES: { value: ResolutionBase; label: string }[] = [
  { value: "votesCast", label: "% of votes cast" },
  { value: "eligibleMembers", label: "% of all eligible members" },
  { value: "quorum", label: "% of the quorum present" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Convert a stored threshold percentage to a comparison fraction, snapping any
 *  value within 0.1% of two-thirds to the exact 2/3 (the 66.67 we display would
 *  otherwise reject an exact two-thirds vote). */
function pctToThresholdFraction(pct: number): number {
  const fraction = pct / 100;
  return Math.abs(fraction - 2 / 3) < 0.001 ? 2 / 3 : fraction;
}

/** The three statutory built-ins, derived fresh from the bylaw thresholds so
 *  editing the Ordinary/Special percentages keeps them in lockstep. */
export function builtInResolutionTypes(rules?: ResolutionRulesLike | null): ResolutionType[] {
  const t = bylawRulesToThresholds(rules);
  return [
    { id: "ordinary", label: "Ordinary", builtIn: true, base: "votesCast", thresholdPct: round2(t.ordinary * 100), order: 0 },
    { id: "special", label: "Special", builtIn: true, base: "votesCast", thresholdPct: round2(t.special * 100), order: 1 },
    { id: "unanimous", label: "Unanimous", builtIn: true, base: "votesCast", thresholdPct: round2(t.unanimous * 100), order: 2 },
  ];
}

/** Custom (non-built-in) resolution types stored on the rule set. */
export function customResolutionTypes(rules?: ResolutionRulesLike | null): ResolutionType[] {
  return (rules?.resolutionTypes ?? []).filter((type) => !type.builtIn);
}

/** The full effective catalogue: built-ins first, then custom types by order. */
export function resolveResolutionTypes(rules?: ResolutionRulesLike | null): ResolutionType[] {
  const custom = [...customResolutionTypes(rules)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return [...builtInResolutionTypes(rules), ...custom];
}

/** Look up a motion's resolution type from the catalogue by id or label
 *  (case-insensitive), so both new (id) and legacy (label) values resolve.
 *  Falls back to Ordinary when unset/unknown. */
export function findResolutionType(types: ResolutionType[], value?: string): ResolutionType | undefined {
  const fallback = types.find((t) => t.id === "ordinary") ?? types[0];
  if (!value) return fallback;
  const needle = value.trim().toLowerCase();
  return (
    types.find((t) => t.id.toLowerCase() === needle) ??
    types.find((t) => t.label.toLowerCase() === needle) ??
    fallback
  );
}

/** Whether a motion's votes meet a given resolution type's threshold (votes-cast
 *  base). Bases other than votesCast need member/quorum context the inline
 *  indicator lacks and are approximated here as votes-cast. */
export function motionCarriesByType(
  m: { votesFor?: number; votesAgainst?: number },
  type?: ResolutionType,
): boolean | null {
  const votesFor = m.votesFor ?? 0;
  const votesAgainst = m.votesAgainst ?? 0;
  const cast = votesFor + votesAgainst;
  if (cast === 0) return null;
  const ratio = votesFor / cast;
  const threshold = pctToThresholdFraction(type?.thresholdPct ?? 50);
  return threshold === 0.5 ? ratio > 0.5 : ratio >= threshold;
}

/** Resolve a motion's configured type from the society's rules and report
 *  whether its recorded tally currently carries.
 *
 *  Returns null (no judgement) when the motion was decided WITHOUT a counted
 *  vote — adopted by general consent or an automatic close — since there is no
 *  tally to weigh. A motion adopted by consent carries by definition; that fact
 *  lives on `outcome`, not on a threshold check. When a procedural motion *is*
 *  put to an actual ballot (e.g. a contested adjournment), it is judged by a
 *  simple majority per RONR rather than being exempted from the math. */
export function motionCarriesForRules(
  m: {
    votesFor?: number;
    votesAgainst?: number;
    resolutionType?: string;
    decidedBy?: string;
    tags?: string[];
    sectionTitle?: string;
  },
  rules?: ResolutionRulesLike | null,
): boolean | null {
  if (isDecidedWithoutVote(m.decidedBy)) return null;
  const types = resolveResolutionTypes(rules);
  // A procedural motion (or the legacy "Procedural" resolution type) with no
  // configured threshold carries by simple majority when actually voted on.
  const proc = classifyProceduralMotion(m as ClassifiableMotion);
  const useMajority =
    (m.resolutionType ?? "") === "Procedural" || (proc != null && !m.resolutionType);
  const type = useMajority
    ? types.find((t) => t.id === "ordinary") ?? types[0]
    : findResolutionType(types, m.resolutionType);
  return motionCarriesByType(m, type);
}

/** Does this motion represent adjourning the meeting? Backed by the shared
 *  procedural-motion catalogue. The MotionEditor uses this to peel the
 *  adjournment record out into its own block. */
export function isAdjournmentMotion(motion: ClassifiableMotion): boolean {
  return classifyProceduralMotion(motion)?.key === "adjournment";
}

/** A motion that approves/adopts the previous meeting's minutes — procedural
 *  bookkeeping that, like adjournment, clutters the master list. */
export function isPreviousMinutesMotion(motion: ClassifiableMotion): boolean {
  return classifyProceduralMotion(motion)?.key === "previous-minutes";
}

/** Routine motions are hidden by the master list's default view (the user can
 *  switch to "All"). Backed by the shared catalogue: an explicit routine tag,
 *  or a routine procedural kind. */
export const ROUTINE_MOTION_TAGS = SHARED_ROUTINE_MOTION_TAGS;
export function isRoutineMotion(motion: ClassifiableMotion): boolean {
  return sharedIsRoutineMotion(motion);
}
