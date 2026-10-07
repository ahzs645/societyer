/**
 * A3: per-body quorum.
 *
 * Bylaws commonly set different quorum rules for general meetings, board
 * meetings and each committee ("60% of directors"; "Quorum is all 5 members").
 * The society-wide `bylawRuleSets.quorumType/quorumValue` could only express
 * one rule and a percentage was only ever computed for general meetings.
 *
 * Resolution order for a meeting:
 *  1. committee meeting: `committees.quorumRule`, else a `bodyQuorumRules` row
 *     for that committee, else a generic `body: "committee"` row;
 *  2. board / general meeting: the matching `bodyQuorumRules` row;
 *  3. otherwise the legacy society rule, unchanged: fixed applies to every
 *     meeting, percentage applies to general meetings only.
 *
 * Pure module so hosted Convex, the local runtime and the UI agree.
 */

export type QuorumRuleLike = {
  quorumType: string; // fixed | percentage | all_members | majority
  quorumValue?: number;
  quorumMinimumCount?: number;
  countBasis?: string; // voting_members | directors_in_office | committee_members
  notes?: string;
};

export type BodyQuorumRule = QuorumRuleLike & {
  body: string; // general | board | committee
  committeeId?: string;
  committeeName?: string;
};

export type MeetingBodyKind = "general" | "board" | "committee";

export const QUORUM_RULE_TYPES = ["fixed", "percentage", "all_members", "majority"] as const;
export const QUORUM_COUNT_BASES = ["voting_members", "directors_in_office", "committee_members"] as const;

export function meetingBodyKind(meetingType?: string | null, committeeId?: string | null): MeetingBodyKind {
  const type = String(meetingType ?? "").trim().toLowerCase();
  if (type === "agm" || type === "sgm" || type.includes("general")) return "general";
  if (committeeId || type === "committee") return "committee";
  return "board";
}

export function defaultCountBasis(body: MeetingBodyKind) {
  return body === "general" ? "voting_members" : body === "committee" ? "committee_members" : "directors_in_office";
}

export type ResolvedQuorumRule = {
  rule: QuorumRuleLike;
  body: MeetingBodyKind;
  source: "committee" | "body_rule" | "society";
  label: string;
};

/** Pick the rule that governs a meeting, or null when none applies. */
export function resolveMeetingQuorumRule(
  rules: { quorumType?: string; quorumValue?: number; quorumMinimumCount?: number; bodyQuorumRules?: BodyQuorumRule[] | null } | null | undefined,
  meeting: { type?: string | null; committeeId?: string | null },
  committee?: { _id?: string; name?: string; quorumRule?: QuorumRuleLike | null } | null,
): ResolvedQuorumRule | null {
  const body = meetingBodyKind(meeting.type, meeting.committeeId);
  const bodyRules = Array.isArray(rules?.bodyQuorumRules) ? rules!.bodyQuorumRules! : [];
  if (body === "committee") {
    if (committee?.quorumRule?.quorumType) {
      return { rule: committee.quorumRule, body, source: "committee", label: `${committee.name ?? "Committee"} quorum rule` };
    }
    const committeeId = meeting.committeeId ? String(meeting.committeeId) : undefined;
    const specific = bodyRules.find((row) => row.body === "committee" && committeeId && String(row.committeeId ?? "") === committeeId);
    const generic = bodyRules.find((row) => row.body === "committee" && !row.committeeId);
    const match = specific ?? generic;
    if (match) return { rule: match, body, source: "body_rule", label: `${match.committeeName ?? committee?.name ?? "Committee"} quorum (bylaw rules)` };
  } else {
    const match = bodyRules.find((row) => row.body === body);
    if (match) return { rule: match, body, source: "body_rule", label: `${body === "general" ? "General meeting" : "Board"} quorum (bylaw rules)` };
  }
  if (!rules?.quorumType) return null;
  if (rules.quorumType === "fixed") return { rule: { quorumType: "fixed", quorumValue: rules.quorumValue, quorumMinimumCount: rules.quorumMinimumCount }, body, source: "society", label: "Society quorum" };
  if (rules.quorumType === "percentage" && body === "general") {
    return { rule: { quorumType: "percentage", quorumValue: rules.quorumValue, quorumMinimumCount: rules.quorumMinimumCount, countBasis: "voting_members" }, body, source: "society", label: "Society quorum" };
  }
  return null;
}

export type QuorumCounts = {
  votingMembers?: number;
  directorsInOffice?: number;
  committeeMembers?: number;
};

export function countForBasis(basis: string, counts: QuorumCounts): number | undefined {
  if (basis === "voting_members") return counts.votingMembers;
  if (basis === "directors_in_office") return counts.directorsInOffice;
  if (basis === "committee_members") return counts.committeeMembers;
  return undefined;
}

/** The number of people required, or undefined when the population is unknown. */
export function computeQuorumFromRule(rule: QuorumRuleLike, body: MeetingBodyKind, counts: QuorumCounts): number | undefined {
  const minimum = rule.quorumMinimumCount ?? 1;
  if (rule.quorumType === "fixed") return typeof rule.quorumValue === "number" ? rule.quorumValue : undefined;
  const population = countForBasis(rule.countBasis || defaultCountBasis(body), counts);
  if (population == null) return undefined;
  if (rule.quorumType === "all_members") return Math.max(minimum, population);
  if (rule.quorumType === "majority") return Math.max(minimum, Math.floor(population / 2) + 1);
  if (rule.quorumType === "percentage" && typeof rule.quorumValue === "number") {
    return Math.max(minimum, Math.ceil(population * (rule.quorumValue / 100)));
  }
  return undefined;
}

/** Validation shared by the bylaw-rules editor and the import contract. */
export function bodyQuorumRuleIssues(rows: unknown): string[] {
  if (rows == null) return [];
  if (!Array.isArray(rows)) return ["bodyQuorumRules must be a list"];
  const issues: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row: any, index) => {
    const where = `bodyQuorumRules[${index}]`;
    if (!["general", "board", "committee"].includes(row?.body)) issues.push(`${where}: body must be general, board or committee`);
    if (!QUORUM_RULE_TYPES.includes(row?.quorumType)) issues.push(`${where}: quorumType must be one of ${QUORUM_RULE_TYPES.join(", ")}`);
    if ((row?.quorumType === "fixed" || row?.quorumType === "percentage") && !(typeof row?.quorumValue === "number" && row.quorumValue > 0)) issues.push(`${where}: quorumValue must be positive`);
    if (row?.quorumType === "percentage" && row?.quorumValue > 100) issues.push(`${where}: a percentage cannot exceed 100`);
    if (row?.countBasis != null && !QUORUM_COUNT_BASES.includes(row.countBasis)) issues.push(`${where}: unknown countBasis`);
    const key = `${row?.body}:${row?.committeeId ?? ""}`;
    if (seen.has(key)) issues.push(`${where}: duplicate rule for the same body`);
    seen.add(key);
  });
  return issues;
}

export const QUORUM_RULE_TYPE_LABELS: Record<string, string> = {
  majority: "Majority (more than half)",
  all_members: "All members",
  fixed: "Fixed number present",
  percentage: "Percentage",
};

export const QUORUM_COUNT_BASIS_LABELS: Record<string, string> = {
  voting_members: "voting members",
  directors_in_office: "directors in office",
  committee_members: "committee members",
};

/** Plain-language summary of a quorum rule, e.g. "Majority of committee members (at least 3)". */
export function describeQuorumRule(rule: QuorumRuleLike | null | undefined, body?: MeetingBodyKind): string {
  if (!rule?.quorumType) return "Not set";
  const basis = QUORUM_COUNT_BASIS_LABELS[rule.countBasis || (body ? defaultCountBasis(body) : "")] ?? "members";
  const minimum = rule.quorumMinimumCount ? ` (at least ${rule.quorumMinimumCount})` : "";
  if (rule.quorumType === "fixed") return `${rule.quorumValue ?? "?"} present`;
  if (rule.quorumType === "majority") return `Majority of ${basis}${minimum}`;
  if (rule.quorumType === "all_members") return `All ${basis}`;
  if (rule.quorumType === "percentage") return `${rule.quorumValue ?? "?"}% of ${basis}${minimum}`;
  return rule.quorumType;
}

/** Problems with one quorum rule as entered in a form (empty when valid). */
export function quorumRuleProblems(rule: QuorumRuleLike | null | undefined): string[] {
  if (!rule?.quorumType) return [];
  const problems: string[] = [];
  if (!(QUORUM_RULE_TYPES as readonly string[]).includes(rule.quorumType)) problems.push("Choose a quorum type.");
  const value = rule.quorumValue;
  if ((rule.quorumType === "fixed" || rule.quorumType === "percentage") && !(typeof value === "number" && Number.isFinite(value) && value > 0)) {
    problems.push(rule.quorumType === "fixed" ? "Enter how many people must be present." : "Enter a percentage above 0.");
  }
  if (rule.quorumType === "fixed" && typeof value === "number" && value > 0 && !Number.isInteger(value)) problems.push("A fixed quorum must be a whole number.");
  if (rule.quorumType === "percentage" && typeof value === "number" && value > 100) problems.push("A percentage cannot exceed 100.");
  const minimum = rule.quorumMinimumCount;
  if (minimum != null && (!Number.isInteger(minimum) || minimum < 0)) problems.push("The minimum must be a whole number of 0 or more.");
  return problems;
}

/** Keep only the fields that apply to the chosen quorum type. */
export function cleanQuorumRule(rule: QuorumRuleLike): QuorumRuleLike {
  const out: QuorumRuleLike = { quorumType: rule.quorumType };
  if ((rule.quorumType === "fixed" || rule.quorumType === "percentage") && typeof rule.quorumValue === "number") out.quorumValue = rule.quorumValue;
  if ((rule.quorumType === "majority" || rule.quorumType === "percentage") && typeof rule.quorumMinimumCount === "number" && rule.quorumMinimumCount > 0) out.quorumMinimumCount = rule.quorumMinimumCount;
  if (rule.quorumType !== "fixed" && rule.countBasis) out.countBasis = rule.countBasis;
  if (rule.notes?.trim()) out.notes = rule.notes.trim().slice(0, 500);
  return out;
}
