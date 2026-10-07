/**
 * G-04: motion vote/outcome validation, shared by the server write paths
 * (motions:create/update/recordVote/setStatus, minutes:create/update) and the
 * MotionEditor / Motions page forms so both say the same thing.
 *
 * Rules:
 *  - vote counts are whole numbers ≥ 0 (or absent);
 *  - when a tally is recorded, the outcome must agree with it:
 *      Carried ⇒ the tally carries; Defeated ⇒ it does not;
 *    using the motion's resolution type (ordinary = majority of votes cast,
 *    special = 2/3, unanimous = no votes against);
 *  - an inconsistent outcome is accepted only when `decidedBy` records a
 *    non-tally decision (general consent / consensus, unanimous consent, a
 *    chair's ruling) AND `outcomeOverrideNote` explains why.
 *
 * Pure module.
 */

export type MotionVoteFields = {
  outcome?: string | null;
  status?: string | null;
  votesFor?: number | null;
  votesAgainst?: number | null;
  abstentions?: number | null;
  resolutionType?: string | null;
  resolutionTypeLabel?: string | null;
  decidedBy?: string | null;
  outcomeOverrideNote?: string | null;
};

/** decidedBy values that may stand against a recorded tally (with a note). */
export const OUTCOME_OVERRIDE_DECIDED_BY = ["consent", "unanimous", "chair_ruling", "automatic"] as const;

const COUNT_FIELDS = [
  ["votesFor", "For"],
  ["votesAgainst", "Against"],
  ["abstentions", "Abstain"],
] as const;

function present(value: unknown): value is number {
  return value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value));
}

/** Messages for invalid counts (negative, fractional, not a number). */
export function motionVoteCountIssues(motion: MotionVoteFields): string[] {
  const issues: string[] = [];
  for (const [field, label] of COUNT_FIELDS) {
    const value = motion[field];
    if (!present(value)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) issues.push(`${label} votes must be a number.`);
    else if (value < 0) issues.push(`${label} votes cannot be negative.`);
    else if (!Number.isInteger(value)) issues.push(`${label} votes must be a whole number.`);
  }
  return issues;
}

/** The fraction of votes cast needed for the resolution type. */
export function resolutionThreshold(resolutionType?: string | null): { kind: "majority" | "special" | "unanimous"; label: string } {
  const value = String(resolutionType ?? "").trim().toLowerCase();
  if (value.includes("unanim")) return { kind: "unanimous", label: "a unanimous vote" };
  if (value.includes("special") || value.includes("two-third") || value.includes("2/3")) return { kind: "special", label: "a two-thirds majority" };
  return { kind: "majority", label: "a majority of votes cast" };
}

/** Does the recorded tally carry? null when no tally is recorded. */
export function tallyCarries(motion: MotionVoteFields): boolean | null {
  const votesFor = present(motion.votesFor) ? Number(motion.votesFor) : 0;
  const votesAgainst = present(motion.votesAgainst) ? Number(motion.votesAgainst) : 0;
  if (votesFor + votesAgainst === 0) return null;
  const threshold = resolutionThreshold(motion.resolutionType ?? motion.resolutionTypeLabel);
  if (threshold.kind === "unanimous") return votesAgainst === 0 && votesFor > 0;
  if (threshold.kind === "special") return votesFor * 3 >= (votesFor + votesAgainst) * 2;
  return votesFor > votesAgainst;
}

function recordedOutcome(motion: MotionVoteFields): "Carried" | "Defeated" | null {
  const outcome = String(motion.outcome ?? "").trim().toLowerCase();
  if (outcome === "carried") return "Carried";
  if (outcome === "defeated") return "Defeated";
  return null;
}

export function hasOutcomeOverride(motion: MotionVoteFields): boolean {
  return (OUTCOME_OVERRIDE_DECIDED_BY as readonly string[]).includes(String(motion.decidedBy ?? ""))
    && String(motion.outcomeOverrideNote ?? "").trim().length > 0;
}

/** Messages for an outcome that contradicts the recorded tally. */
export function motionOutcomeConsistencyIssues(motion: MotionVoteFields): string[] {
  const outcome = recordedOutcome(motion);
  if (!outcome) return [];
  const carries = tallyCarries(motion);
  if (carries === null) return [];
  if ((outcome === "Carried") === carries) return [];
  if (hasOutcomeOverride(motion)) return [];
  const threshold = resolutionThreshold(motion.resolutionType ?? motion.resolutionTypeLabel);
  const tally = `${Number(motion.votesFor ?? 0)} for, ${Number(motion.votesAgainst ?? 0)} against`;
  const overrideHint = "If it was decided by consensus, unanimous consent or a chair's ruling, set “Decided by” and add an override note.";
  return outcome === "Carried"
    ? [`Outcome is Carried but the recorded votes (${tally}) do not reach ${threshold.label}. ${overrideHint}`]
    : [`Outcome is Defeated but the recorded votes (${tally}) reach ${threshold.label}. ${overrideHint}`];
}

/** All validation messages for a motion's vote and outcome fields. */
export function motionVoteIssues(motion: MotionVoteFields): string[] {
  const countIssues = motionVoteCountIssues(motion);
  if (countIssues.length) return countIssues;
  return motionOutcomeConsistencyIssues(motion);
}

/** Throw a single readable error when the motion's votes/outcome are invalid. */
export function assertMotionVotes(motion: MotionVoteFields, label = "Motion"): void {
  const issues = motionVoteIssues(motion);
  if (issues.length) throw new Error(`${label}: ${issues.join(" ")}`);
}

/** Whether a patch touches the fields this validation reads. */
export function touchesMotionVoteFields(patch: Record<string, unknown>): boolean {
  return ["outcome", "status", "votesFor", "votesAgainst", "abstentions", "resolutionType", "resolutionTypeLabel", "decidedBy", "outcomeOverrideNote"]
    .some((key) => Object.prototype.hasOwnProperty.call(patch, key));
}

/** Imported/source counts: drop impossible values instead of failing the import. */
export function sanitizeImportedVoteCount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}
