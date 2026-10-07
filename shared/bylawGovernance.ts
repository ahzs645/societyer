/**
 * BYLAW GOVERNANCE CHECKS — pure validation shared by the bylaw-amendment and
 * bylaw-rule portable mutations and their editors.
 *
 * Statutory anchors (BC Societies Act, SBC 2015, c. 18; current to 2026):
 *  - s.1(1) "special resolution": a resolution passed at a general meeting by
 *    at least two-thirds of the votes cast by the voting members (or a higher
 *    majority set by the bylaws), or a written resolution consented to by all
 *    voting members.
 *  - s.17(1): a society may alter its bylaws only by special resolution; the
 *    alteration takes effect when it is filed with the registrar (s.17(3)), so
 *    rule versions are prospective, never retroactive.
 *  - ss.77-78: notice of a general meeting is generally 14 to 60 days before the
 *    meeting; the bylaws can set a shorter minimum of not less than 7 days.
 *  - s.82: quorum is 3 voting members unless the bylaws require more (if a
 *    society has fewer voting members, all of them form quorum).
 * BC companies (Business Corporations Act s.1 "special majority") likewise
 * require two-thirds up to three-quarters as set by the articles.
 *
 * Framework-free so it runs on hosted Convex, the local runtime and Node gates.
 */

import { canonicalizeJurisdictionCode, homeJurisdictionCode, isCorporation, isSociety } from "./organizationDomain";

/** Statutory context for rule validation, derived from the organization row. */
export function bylawRuleContextFor(organization: any): BylawRuleContext {
  const jurisdiction = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  const corporation = isCorporation(organization);
  const bcSociety = !corporation && (isSociety(organization) || organization?.actFormedUnder === "societies_act" || organization?.actFormedUnder === "bc_societies_act") && jurisdiction === "CA-BC";
  return { bcSociety, corporation };
}

export const SPECIAL_RESOLUTION_CITATION =
  "BC Societies Act s.1(1) \"special resolution\" (at least 2/3 of votes cast); bylaw alterations require a special resolution under s.17(1)";

export type VoteCounts = {
  votesFor?: number | null;
  votesAgainst?: number | null;
  abstentions?: number | null;
};

/** Returns human-readable problems with a set of vote counts (empty = valid).
 *  Counts must be whole, non-negative numbers; at least one vote must be cast. */
export function voteCountProblems(votes: VoteCounts, options: { requireVotesFor?: boolean } = {}): string[] {
  const problems: string[] = [];
  const check = (label: string, value: number | null | undefined) => {
    if (value == null) return;
    if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`${label} must be a number.`);
    else if (value < 0) problems.push(`${label} cannot be negative.`);
    else if (!Number.isInteger(value)) problems.push(`${label} must be a whole number.`);
    else if (value > 10_000_000) problems.push(`${label} is implausibly large.`);
  };
  if (options.requireVotesFor && votes.votesFor == null) problems.push("Votes for is required.");
  check("Votes for", votes.votesFor);
  check("Votes against", votes.votesAgainst);
  check("Abstentions", votes.abstentions);
  if (!problems.length && (votes.votesFor ?? 0) + (votes.votesAgainst ?? 0) === 0 && options.requireVotesFor) {
    problems.push("At least one vote must be cast for or against.");
  }
  return problems;
}

/** Snap a stored percentage (66.67) to the exact 2/3 fraction. */
export function thresholdFraction(pct: number | null | undefined, fallback = 2 / 3): number {
  if (pct == null || !Number.isFinite(pct)) return fallback;
  const fraction = pct / 100;
  return Math.abs(fraction - 2 / 3) < 0.001 ? 2 / 3 : fraction;
}

export type SpecialResolutionResult = {
  passed: boolean;
  votesCast: number;
  /** Share of votes cast in favour (0-1). */
  ratio: number;
  /** Required share of votes cast (0-1). */
  required: number;
  /** Minimum "for" votes needed with this many votes cast. */
  minimumFor: number;
  summary: string;
};

/**
 * Evaluate a special resolution at a general meeting. Abstentions are not
 * votes cast. Two-thirds is compared exactly with integer arithmetic so an
 * exact 2/3 vote passes and 66.66% does not.
 */
export function evaluateSpecialResolution(
  votes: VoteCounts,
  specialResolutionThresholdPct?: number | null,
): SpecialResolutionResult {
  const votesFor = Math.max(0, Math.trunc(votes.votesFor ?? 0));
  const votesAgainst = Math.max(0, Math.trunc(votes.votesAgainst ?? 0));
  const votesCast = votesFor + votesAgainst;
  const required = Math.max(2 / 3, thresholdFraction(specialResolutionThresholdPct));
  const exactTwoThirds = required === 2 / 3;
  const passed = votesCast > 0 && (exactTwoThirds ? votesFor * 3 >= votesCast * 2 : votesFor / votesCast >= required - 1e-12);
  const minimumFor = votesCast === 0 ? 0 : exactTwoThirds ? Math.ceil((votesCast * 2) / 3) : Math.ceil(votesCast * required - 1e-9);
  const ratio = votesCast ? votesFor / votesCast : 0;
  const pct = (value: number) => `${(Math.round(value * 10000) / 100).toFixed(2).replace(/\.00$/, "")}%`;
  const summary = votesCast === 0
    ? "No votes were cast for or against."
    : `${votesFor} of ${votesCast} votes cast in favour (${pct(ratio)}); a special resolution needs ${exactTwoThirds ? "two-thirds" : pct(required)} (${minimumFor} of ${votesCast}).`;
  return { passed, votesCast, ratio, required, minimumFor, summary };
}

// ---------------------------------------------------------------------------
// Bylaw rule set validation (G-06)
// ---------------------------------------------------------------------------

export type BylawRuleValues = {
  generalNoticeMinDays?: number;
  generalNoticeMaxDays?: number;
  quorumType?: string;
  quorumValue?: number;
  quorumMinimumCount?: number;
  ordinaryResolutionThresholdPct?: number;
  specialResolutionThresholdPct?: number;
  memberProposalThresholdPct?: number;
  requisitionMeetingThresholdPct?: number;
  annualReportDueDaysAfterMeeting?: number;
  proxyLimitPerGrantorPerMeeting?: number;
  resolutionTypes?: { label?: string; thresholdPct?: number; base?: string }[];
};

export type BylawRuleContext = {
  /** True for a BC society governed by the Societies Act. */
  bcSociety: boolean;
  /** True for a corporation (articles/by-laws, not the Societies Act). */
  corporation?: boolean;
};

const isWhole = (value: unknown) => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);

/** Problems that make a bylaw rule set impossible or unlawful (empty = valid). */
export function bylawRuleProblems(values: BylawRuleValues, context: BylawRuleContext): string[] {
  const problems: string[] = [];
  const min = values.generalNoticeMinDays;
  const max = values.generalNoticeMaxDays;
  if (!isWhole(min) || (min as number) < 0) problems.push("Notice minimum must be a whole number of days.");
  if (!isWhole(max) || (max as number) < 1) problems.push("Notice maximum must be a whole number of days.");
  if (isWhole(min) && isWhole(max) && (min as number) > (max as number)) {
    problems.push(`Notice minimum (${min} days) cannot be greater than the notice maximum (${max} days).`);
  }
  if (context.bcSociety) {
    if (isWhole(min) && (min as number) < 7) problems.push("BC societies must give at least 7 days' notice of a general meeting (Societies Act ss.77-78; bylaws may reduce the 14-day default to no less than 7).");
    if (isWhole(max) && (max as number) > 60) problems.push("BC societies cannot give notice more than 60 days before a general meeting (Societies Act s.77).");
  }
  if (values.quorumType === "percentage") {
    if (!isNumber(values.quorumValue) || (values.quorumValue as number) <= 0 || (values.quorumValue as number) > 100) {
      problems.push("A percentage quorum must be greater than 0% and at most 100%.");
    }
    if (values.quorumMinimumCount != null && (!isWhole(values.quorumMinimumCount) || (values.quorumMinimumCount as number) < 0)) {
      problems.push("The minimum quorum headcount must be a whole number.");
    }
  } else {
    if (!isWhole(values.quorumValue) || (values.quorumValue as number) < 1) {
      problems.push("A fixed quorum must be at least 1 person present.");
    } else if (context.bcSociety && (values.quorumValue as number) < 3) {
      problems.push("BC Societies Act s.82: quorum is 3 voting members unless the bylaws require more (a society with fewer voting members needs all of them).");
    }
  }
  const ordinary = values.ordinaryResolutionThresholdPct;
  const special = values.specialResolutionThresholdPct;
  if (!isNumber(ordinary) || (ordinary as number) < 50 || (ordinary as number) > 100) {
    problems.push("The ordinary resolution threshold must be between 50% and 100% of votes cast.");
  }
  if (!isNumber(special) || (special as number) > 100) {
    problems.push("The special resolution threshold must be a percentage of at most 100%.");
  } else if ((special as number) < 66.66) {
    problems.push(`The special resolution threshold cannot be below two-thirds (${SPECIAL_RESOLUTION_CITATION}).`);
  }
  if (isNumber(ordinary) && isNumber(special) && (ordinary as number) > (special as number)) {
    problems.push("The ordinary resolution threshold cannot exceed the special resolution threshold.");
  }
  for (const [label, value] of [
    ["Member proposal threshold", values.memberProposalThresholdPct],
    ["Requisition threshold", values.requisitionMeetingThresholdPct],
  ] as const) {
    if (value != null && (!isNumber(value) || value < 0 || value > 100)) problems.push(`${label} must be between 0% and 100%.`);
  }
  if (values.annualReportDueDaysAfterMeeting != null && (!isWhole(values.annualReportDueDaysAfterMeeting) || values.annualReportDueDaysAfterMeeting < 0)) {
    problems.push("Annual report due days must be a whole, non-negative number.");
  }
  if (values.proxyLimitPerGrantorPerMeeting != null && (!isWhole(values.proxyLimitPerGrantorPerMeeting) || values.proxyLimitPerGrantorPerMeeting < 0)) {
    problems.push("The proxy limit must be a whole, non-negative number.");
  }
  (values.resolutionTypes ?? []).forEach((type, index) => {
    const name = String(type?.label ?? "").trim();
    const where = name ? `Custom resolution type "${name}"` : `Custom resolution type #${index + 1}`;
    if (!name) problems.push(`${where} needs a name.`);
    if (!isNumber(type?.thresholdPct) || (type!.thresholdPct as number) <= 0 || (type!.thresholdPct as number) > 100) {
      problems.push(`${where} needs a threshold greater than 0% and at most 100%.`);
    }
  });
  return problems;
}

/**
 * Effective-dating guard: a new rule version must not take effect on or before
 * the effective date of the version it replaces unless the caller explicitly
 * acknowledges the backdating (meetings already held in between would be
 * re-evaluated). Returns a problem string, or null when acceptable.
 */
export function bylawRuleEffectiveDateProblem(
  newEffectiveFromISO: string | undefined,
  existing: { version?: number; effectiveFromISO?: string; status?: string }[],
  options: { allowBackdated?: boolean } = {},
): string | null {
  if (options.allowBackdated) return null;
  const effective = String(newEffectiveFromISO ?? "").slice(0, 10);
  if (!effective) return null;
  const latest = existing
    .filter((row) => row.status !== "Draft" && row.effectiveFromISO)
    .sort((a, b) => String(b.effectiveFromISO).localeCompare(String(a.effectiveFromISO)))[0];
  if (!latest) return null;
  const latestDate = String(latest.effectiveFromISO).slice(0, 10);
  if (effective <= latestDate) {
    return `The new version would take effect ${effective}, on or before v${latest.version ?? "?"} (effective ${latestDate}). Bylaw changes are prospective (BC Societies Act s.17): choose a later effective date, or confirm that you are recording a historical rule version.`;
  }
  return null;
}
