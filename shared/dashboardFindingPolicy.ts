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
 * until the evidence resolves it; people can acknowledge it, assign a
 * follow-up or snooze its reminders, and all three leave it on the dashboard
 * and in every count. A rule id this module does not know is treated as a
 * requirement (fail closed).
 *
 * A few rules rest on a different basis at a different level: the
 * constitution and bylaws checks are statutory while no copy is identified
 * ("warn"), but the "on record, currentness not verified" note ("info") is a
 * recommendation. `findingPolicy(ruleId, level)` applies those; without a
 * level the rule-wide (stricter) basis applies.
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

/**
 * How the dashboard computes a finding's subject: per affected director, from
 * its text, or from the identity of the governing-document copy on record
 * (the document id, or the held-elsewhere entry's reference and when it was
 * recorded), so replacing the copy brings a dismissed note back.
 */
export type FindingSubject = "directors" | "text" | "governingCopy";

/** The society field a `governingCopy` subject reads (shared/governingDocumentEvidence.ts). */
export type GoverningCopyField = "constitutionDocId" | "bylawsDocId";

export type FindingPolicy = {
  /** Undefined for a rule id this module does not classify (treated as a requirement). */
  basis?: RequirementBasis;
  /** Bumped when what the rule checks changes, so old dismissals stop applying. */
  version: number;
  /** True when the finding stays outstanding until resolved (never dismissable). */
  protected: boolean;
  subject: FindingSubject;
  /** Set for a `governingCopy` subject. */
  evidenceField?: GoverningCopyField;
};

type LevelEntry = { basis: RequirementBasis; subject?: FindingSubject; evidenceField?: GoverningCopyField };
type PolicyEntry = LevelEntry & {
  version?: number;
  /** A different basis (and subject) at one level; every other level uses the entry itself. */
  byLevel?: Partial<Record<"info" | "warn" | "err", LevelEntry>>;
};

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
  // Societies Act s.20: constitution and bylaws are records the society keeps,
  // so "not identified" (warn) is statutory. Once a copy is identified, the
  // "currentness not verified" note (info) is good practice, held to that copy.
  "BC-SOC-CONSTITUTION-EVIDENCE": {
    basis: "statutory",
    byLevel: { info: { basis: "recommendation", subject: "governingCopy", evidenceField: "constitutionDocId" } },
  },
  "BC-SOC-BYLAWS-EVIDENCE": {
    basis: "statutory",
    byLevel: { info: { basis: "recommendation", subject: "governingCopy", evidenceField: "bylawsDocId" } },
  },
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
];

/**
 * Compliance-obligation rules (src/lib/compliance/rulePacks) that are
 * good-practice reviews: the rule cites guidance rather than a section that
 * requires the review, and nothing is filed. Each occurrence can be dismissed
 * on its own; the next period's occurrence shows again. Every other
 * obligation rule (filings, statutory deadlines, anything citing a section)
 * is statutory, and so is any obligation rule id not listed here.
 */
export const OBLIGATION_RECOMMENDATION_RULE_IDS: ReadonlySet<string> = new Set([
  // "BC Societies Act records guidance": an annual inspection-readiness review.
  "compliance-ca-bc-societies-records-review",
  // "BC Societies Act director requirements": an annual re-check. The
  // minimum and residency duties themselves are dashboard rules.
  "compliance-ca-bc-societies-director-minimum-review",
  // "BC Business Corporations Act director and records guidance".
  "compliance-ca-bc-company-director-minimum-review",
  // "BC Business Corporations Act records and registry evidence workflow".
  "compliance-ca-bc-extra-provincial-profile-evidence",
  // "CBCA annual filing and records guidance": who holds the registry key.
  "compliance-ca-fed-cbca-corporation-key-custody",
  // "CBCA corporate records guidance": a minute-book completeness review.
  "compliance-ca-fed-cbca-corporate-records-review",
]);

/** "<context>:<ruleId>:<due date>" (the context may hold colons) or a bare obligation rule id. */
const OBLIGATION_ID = /^(?:.+:)?(compliance-[a-z0-9-]+)(?::\d{4}-\d{2}-\d{2})?$/;

/** The obligation rule id inside an occurrence key, or undefined for any other id. */
export function obligationRuleId(id: string): string | undefined {
  return OBLIGATION_ID.exec(id)?.[1];
}

function entryFor(ruleId: string): PolicyEntry | undefined {
  const known = EXACT[ruleId] ?? PATTERNS.find(({ pattern }) => pattern.test(ruleId))?.entry;
  if (known) return known;
  const obligation = obligationRuleId(ruleId);
  if (!obligation) return undefined;
  return { basis: OBLIGATION_RECOMMENDATION_RULE_IDS.has(obligation) ? "recommendation" : "statutory", subject: "text" };
}

/**
 * The policy for one rule, check or obligation occurrence id, at the
 * finding's level when given. Without a level, a rule whose basis depends on
 * the level gets its rule-wide (stricter) basis.
 */
export function findingPolicy(ruleId: string, level?: unknown): FindingPolicy {
  const base = entryFor(String(ruleId ?? ""));
  if (!base) return { version: 1, protected: true, subject: "text" };
  const atLevel = level === "info" || level === "warn" || level === "err" ? base.byLevel?.[level] : undefined;
  const entry: LevelEntry = atLevel ?? base;
  return {
    basis: entry.basis,
    version: base.version ?? 1,
    protected: entry.basis !== "recommendation",
    subject: entry.subject ?? "text",
    ...(entry.evidenceField ? { evidenceField: entry.evidenceField } : {}),
  };
}

/** True when the rule is a requirement at every level, so nothing about it can be dismissed. */
export function isProtectedAtEveryLevel(ruleId: string): boolean {
  const entry = entryFor(String(ruleId ?? ""));
  if (!entry) return true;
  return [entry, ...Object.values(entry.byLevel ?? {})].every((variant) => variant?.basis !== "recommendation");
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
