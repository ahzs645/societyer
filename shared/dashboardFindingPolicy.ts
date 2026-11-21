/**
 * What a dashboard finding rests on, and so what a workspace may do with it
 * (pure, dependency-free).
 *
 * Severity (the level's colour) and dismissability are separate questions: an
 * amber item can be an unresolved legal requirement. Every compliance flag,
 * continuity check and compliance-obligation occurrence resolves here, by its
 * rule id, to a requirement basis:
 *
 *   statutory        an act or regulation requires it
 *   bylaw            the organization's own bylaws require it
 *   internal_policy  a control or policy the organization has adopted
 *   recommendation   good practice the workspace may decline
 *
 * Only recommendations can be dismissed. Everything else stays outstanding
 * until the evidence resolves it; people can acknowledge it or assign a
 * follow-up, and both leave it on the dashboard and in every count. A rule id
 * this module does not know is treated as a requirement (fail closed).
 *
 * The same policy is applied by the dashboard reads (shared/functions/
 * dashboard.ts, continuity.ts), the dismiss/acknowledge mutations
 * (dashboardRemediation.ts) and the obligations page mutations
 * (complianceObligations.ts), so a client cannot dismiss a requirement by
 * sending a different level.
 */

import { isBindingSeverity, isRecommendationLevel } from "./dashboardDismissals";

export type RequirementBasis = "statutory" | "bylaw" | "internal_policy" | "recommendation";

/** Short labels for the UI. */
export const REQUIREMENT_BASIS_LABEL: Record<RequirementBasis, string> = {
  statutory: "Statutory requirement",
  bylaw: "Bylaw requirement",
  internal_policy: "Internal policy",
  recommendation: "Recommendation",
};

export type FindingPolicy = {
  /** Undefined for a rule id this module does not classify (treated as a requirement). */
  basis?: RequirementBasis;
  /** Bumped when what the rule checks changes, so old dismissals stop applying. */
  version: number;
  /** True when the finding stays outstanding until resolved (never dismissable). */
  protected: boolean;
  /** How the dashboard computes the finding's subject: per affected director, or from its text. */
  subject: "directors" | "text";
};

type PolicyEntry = { basis: RequirementBasis; version?: number; subject?: "directors" | "text" };

/**
 * Dashboard compliance flags (shared/dashboardComplianceRules.ts), finance
 * control findings (shared/expenseApprovals.ts) and continuity checks
 * (shared/functions/continuity.ts), by exact id.
 */
const EXACT: Record<string, PolicyEntry> = {
  // BC Societies Act (ss.40, 197)
  "BC-SOC-DIRECTORS-MIN": { basis: "statutory" },
  "BC-SOC-DIRECTORS-BC-RESIDENT": { basis: "statutory" },
  // Societies Act s.42(4): written consent or attendance without refusal.
  "BC-SOC-DIRECTOR-CONSENT": { basis: "statutory", subject: "directors" },
  // BC PIPA ss.4-5: policies and practices, responsible person.
  "PIPA-POLICY-DOCUMENTED": { basis: "statutory" },
  "PIPA-POLICY-EVIDENCE": { basis: "statutory" },
  // Societies Act s.20 records (register of members) and PIPA.
  "MEMBER-DATA-ACCESS-STATUS": { basis: "statutory" },
  "MEMBER-DATA-GAP-MEMO": { basis: "statutory" },
  // Societies Act s.20: constitution and bylaws are records the society keeps.
  "BC-SOC-CONSTITUTION-EVIDENCE": { basis: "statutory" },
  "BC-SOC-BYLAWS-EVIDENCE": { basis: "statutory" },
  // Configuring Societyer's bylaw rule set: the bylaws themselves still apply.
  "BYLAW-RULE-SET-CONFIGURED": { basis: "recommendation" },
  // Which privacy law applies is an assessment; the duties it finds are separate rules.
  "PRIVACY-APPLICABILITY": { basis: "recommendation" },
  // Status notes, never gaps.
  "DASHBOARD-COMPLIANCE-OK": { basis: "recommendation" },
  "DASHBOARD-COMPLIANCE-PREPARING": { basis: "recommendation" },
  // Finance controls: good practice, except where the approval rules fall
  // behind the signing authority the organization has adopted.
  "FINANCE-CONTROL-SINGLE-APPROVAL": { basis: "recommendation" },
  "FINANCE-CONTROL-SELF-APPROVAL": { basis: "recommendation" },
  "FINANCE-CONTROL-SIGNING-AUTHORITY": { basis: "internal_policy" },
  // Continuity checks. A check whose expectation is marked statutory or
  // bylaw is a requirement whatever this table says (continuityFindingPolicy).
  "CONTINUITY-AGM-THIS-YEAR": { basis: "statutory" },
  "CONTINUITY-ANNUAL-REPORT-FILED": { basis: "statutory" },
  "CONTINUITY-DIRECTOR-CONSENT": { basis: "statutory" },
  "CONTINUITY-MINUTES-APPROVED": { basis: "recommendation" },
  "CONTINUITY-AGREEMENT-OBLIGATIONS": { basis: "recommendation" },
};

/** Rule families whose ids carry a governance profile or privacy law id. */
const PATTERNS: { pattern: RegExp; entry: PolicyEntry }[] = [
  { pattern: /^LEGAL-[a-z0-9_]+-DIRECTORS-MIN$/i, entry: { basis: "statutory" } },
  { pattern: /^LEGAL-[a-z0-9_]+-DIRECTOR-CONSENT$/i, entry: { basis: "statutory", subject: "directors" } },
  { pattern: /^LEGAL-[a-z0-9_]+-DIRECTORS-RESIDENCY$/i, entry: { basis: "statutory" } },
  { pattern: /^LEGAL-[a-z0-9_]+-CLASSIFICATION$/i, entry: { basis: "statutory" } },
  { pattern: /^LEGAL-[a-z0-9_]+-GOVERNING-DOCUMENTS$/i, entry: { basis: "statutory" } },
  { pattern: /^PRIVACY-[a-z0-9_]+-OFFICER$/i, entry: { basis: "statutory" } },
  { pattern: /^PRIVACY-[a-z0-9_]+-POLICY$/i, entry: { basis: "statutory" } },
  // Compliance-obligation occurrences ("<context>:<ruleId>:<due date>") from
  // the statute-based rule packs in src/lib/compliance/rulePacks.
  { pattern: /^[^:]+:compliance-[a-z0-9-]+:\d{4}-\d{2}-\d{2}$/, entry: { basis: "statutory", subject: "text" } },
  { pattern: /^compliance-[a-z0-9-]+$/, entry: { basis: "statutory", subject: "text" } },
];

function entryFor(ruleId: string): PolicyEntry | undefined {
  return EXACT[ruleId] ?? PATTERNS.find(({ pattern }) => pattern.test(ruleId))?.entry;
}

/** The policy for one rule, check or obligation occurrence id. */
export function findingPolicy(ruleId: string): FindingPolicy {
  const entry = entryFor(String(ruleId ?? ""));
  if (!entry) return { version: 1, protected: true, subject: "text" };
  return {
    basis: entry.basis,
    version: entry.version ?? 1,
    protected: entry.basis !== "recommendation",
    subject: entry.subject ?? "text",
  };
}

/** True when this module classifies the id (tests use it to catch new, unclassified rules). */
export function isClassifiedFinding(ruleId: string): boolean {
  return entryFor(ruleId) !== undefined;
}

/**
 * A continuity check's policy: the table above, made stricter when the
 * workspace's expectation rests on a statutory or bylaw duty.
 */
export function continuityFindingPolicy(checkId: string, requirement: unknown): FindingPolicy {
  const policy = findingPolicy(checkId);
  if (policy.protected || !isBindingSeverity(requirement)) return policy;
  return { ...policy, basis: requirement === "bylaw" ? "bylaw" : "statutory", protected: true };
}

/** A finding can be dismissed only when it is a recommendation at "warn" or "info". */
export function isDismissableFinding(policy: FindingPolicy, level: unknown): boolean {
  return !policy.protected && isRecommendationLevel(level);
}

/**
 * Whether a stored decision takes an obligation occurrence out of the
 * outstanding counts. Only a dismissed recommendation does; an acknowledged
 * requirement, or one dismissed before this policy existed, stays counted.
 */
export function decisionWaivesFinding(ruleId: string, decision: { status?: string } | null | undefined): boolean {
  return decision?.status === "dismissed" && !findingPolicy(ruleId).protected;
}

/**
 * The finding's subject: the rule (and its version) plus what it is about. A
 * dismissal or acknowledgement holds only while the subject is unchanged, so a
 * new affected director, record or period shows the finding again.
 */
export function findingSubjectKey(ruleId: string, parts: readonly string[]): string {
  const { version } = findingPolicy(ruleId);
  const normalized = [...new Set(parts.map((part) => String(part).trim().replace(/\s+/g, " ")))].sort();
  return `${ruleId}@v${version}:${fnv1a(normalized.join("\u0000"))}`;
}

/** 32-bit FNV-1a, hex: short and stable across runtimes. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
