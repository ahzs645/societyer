/**
 * Expense-claim approval policy: ordered amount-threshold rules
 * ("claims of $X or more need N approvals from these roles/people"), shared by
 * the server mutation that enforces them and the approvals queue that explains
 * them. Pure and dependency-free.
 */

export const APPROVER_ROLES = ["Owner", "Admin", "Director"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export type ApprovalRule = {
  _id?: string;
  /** Applies to claims whose amount is at least this many cents. */
  minAmountCents: number;
  requiredApprovals: number;
  /** Roles whose members may approve. Empty with no people = any approver role. */
  approverRoles: string[];
  /** Specific people who may approve, in addition to the roles above. */
  approverUserIds: string[];
  /** The requester cannot approve their own claim. */
  blockSelfApproval: boolean;
  enabled: boolean;
  label?: string;
};

/**
 * Who may record an approval vote, per workspace:
 * - "finance_writers" (default): approving needs finance edit access (the
 *   permission marking claims paid and editing rules needs); the rules still
 *   apply on top (count, approver roles/people, no self-approval).
 * - "rule_roles": anyone with finance read access whose role or name is listed
 *   in the matching rule may approve, including read-only directors.
 * Viewers and members never approve under either setting.
 */
export const APPROVER_ACCESS_MODES = ["finance_writers", "rule_roles"] as const;
export type ApproverAccess = (typeof APPROVER_ACCESS_MODES)[number];
export const DEFAULT_APPROVER_ACCESS: ApproverAccess = "finance_writers";
export const FINANCE_EDIT_REQUIRED_REASON = "Approving requires finance edit access in this workspace.";

/** Stored values outside the known modes fall back to the (stricter) default. */
export function normalizeApproverAccess(value: unknown): ApproverAccess {
  return APPROVER_ACCESS_MODES.includes(value as ApproverAccess) ? (value as ApproverAccess) : DEFAULT_APPROVER_ACCESS;
}

/** The workspace setting plus whether this person holds finance edit access. */
export type ApproverAccessContext = { approverAccess: ApproverAccess; hasFinanceWrite: boolean };

export type ApprovalVote = { userId: string; name: string; role?: string; atISO: string };

export type ApproverCandidate = { _id: string; role?: string | null; status?: string | null };

export type ClaimForApproval = {
  amountCents: number;
  claimantUserId?: string | null;
  approvals?: readonly ApprovalVote[] | null;
};

export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  { minAmountCents: 0, requiredApprovals: 1, approverRoles: [], approverUserIds: [], blockSelfApproval: true, enabled: true, label: "Default" },
  { minAmountCents: 500_000, requiredApprovals: 2, approverRoles: [], approverUserIds: [], blockSelfApproval: true, enabled: true, label: "Dual approval" },
];

export type SigningAuthorityLike = {
  status?: string | null;
  endDate?: string | null;
  authorityType?: string | null;
  tiers?: readonly { minCents?: number | null; maxCents?: number | null; signaturesRequired: number; notes?: string | null }[] | null;
};

/**
 * Threshold rules derived from recorded signing-authority tiers (for example
 * "one signature up to $5,000; two above"). Returns null when no active
 * signing authority records tiers.
 */
export function rulesFromSigningAuthorities(rows: readonly SigningAuthorityLike[], asOf: string): ApprovalRule[] | null {
  const byMin = new Map<number, number>();
  for (const row of rows) {
    if (row.status && !/^(active|current|verified)$/i.test(row.status)) continue;
    if (row.endDate && row.endDate < asOf) continue;
    if (row.authorityType && !/sign|bank|cheque/i.test(row.authorityType)) continue;
    for (const tier of row.tiers ?? []) {
      const required = Math.max(1, Math.round(Number(tier.signaturesRequired) || 1));
      // Kept exact: a tier that starts at $5,000.01 leaves $5,000.00 in the lower tier.
      const min = Math.max(0, Math.round(Number(tier.minCents ?? 0)));
      byMin.set(min, Math.max(byMin.get(min) ?? 0, required));
    }
  }
  if (byMin.size === 0) return null;
  const sorted = [...byMin.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted[0][0] !== 0) sorted.unshift([0, 1]);
  const rules: ApprovalRule[] = [];
  for (const [minAmountCents, requiredApprovals] of sorted) {
    // Drop tiers that do not change the requirement.
    if (rules.length && rules[rules.length - 1].requiredApprovals === requiredApprovals) continue;
    rules.push({ minAmountCents, requiredApprovals, approverRoles: [], approverUserIds: [], blockSelfApproval: true, enabled: true, label: "From signing authority" });
  }
  return rules;
}

/** The enabled rule with the highest threshold the amount meets. */
export function ruleForAmount<T extends ApprovalRule>(rules: readonly T[], amountCents: number): T | null {
  const amount = Math.abs(Math.round(amountCents));
  let best: T | null = null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (amount < rule.minAmountCents) continue;
    if (!best || rule.minAmountCents > best.minAmountCents) best = rule;
  }
  return best;
}

export type Eligibility = { eligible: true } | { eligible: false; reason: string };

function isApproverRole(role: string | null | undefined): role is ApproverRole {
  return APPROVER_ROLES.includes(String(role) as ApproverRole);
}

/**
 * Whether this person may approve the claim under the rule. Pass `access`
 * (the workspace's approver-access setting and the person's finance edit
 * access) wherever a vote is recorded or offered; without it only the rule
 * itself is checked.
 */
export function approverEligibility(rule: ApprovalRule, user: ApproverCandidate, claim: ClaimForApproval, access?: ApproverAccessContext): Eligibility {
  if (user.status && user.status !== "Active") return { eligible: false, reason: "Your membership is not active." };
  if (!isApproverRole(user.role)) return { eligible: false, reason: "Only owners, admins and directors can approve claims." };
  if (access && normalizeApproverAccess(access.approverAccess) === "finance_writers" && !access.hasFinanceWrite) {
    return { eligible: false, reason: FINANCE_EDIT_REQUIRED_REASON };
  }
  if (rule.blockSelfApproval && claim.claimantUserId && String(claim.claimantUserId) === String(user._id)) {
    return { eligible: false, reason: "You can't approve your own claim." };
  }
  const roles = rule.approverRoles ?? [];
  const people = (rule.approverUserIds ?? []).map(String);
  if (roles.length || people.length) {
    const byRole = roles.includes(String(user.role));
    const byPerson = people.includes(String(user._id));
    if (!byRole && !byPerson) return { eligible: false, reason: "You aren't an approver for claims of this size." };
  }
  if ((claim.approvals ?? []).some((vote) => String(vote.userId) === String(user._id))) {
    return { eligible: false, reason: "You've already approved this claim." };
  }
  return { eligible: true };
}

export function approvalProgress(rule: Pick<ApprovalRule, "requiredApprovals"> | null, claim: ClaimForApproval) {
  const required = Math.max(1, rule?.requiredApprovals ?? 1);
  const count = (claim.approvals ?? []).length;
  return { required, count, remaining: Math.max(0, required - count), complete: count >= required };
}

/** Problems with a rule set (ordered thresholds, sensible counts). */
export function validateApprovalRules(rules: readonly ApprovalRule[]): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  rules.forEach((rule, index) => {
    const n = index + 1;
    if (!Number.isSafeInteger(rule.minAmountCents) || rule.minAmountCents < 0) errors.push(`Rule ${n}: enter a threshold of $0 or more.`);
    if (!Number.isSafeInteger(rule.requiredApprovals) || rule.requiredApprovals < 1 || rule.requiredApprovals > 5) errors.push(`Rule ${n}: require between 1 and 5 approvals.`);
    if (rule.approverRoles.some((role) => !isApproverRole(role))) errors.push(`Rule ${n}: approvers must be owners, admins or directors.`);
    if (seen.has(rule.minAmountCents)) errors.push(`Rule ${n}: another rule already starts at this amount.`);
    seen.add(rule.minAmountCents);
  });
  if (rules.length && !rules.some((rule) => rule.enabled && rule.minAmountCents === 0)) {
    errors.push("Add an enabled rule starting at $0 so every claim has an approver.");
  }
  return errors;
}

/** Number of eligible approvers available for a rule — a rule nobody can satisfy is a configuration error. */
export function eligibleApproverCount(
  rule: ApprovalRule,
  users: readonly ApproverCandidate[],
  claim: ClaimForApproval,
  access?: { approverAccess: ApproverAccess; hasFinanceWrite: (user: ApproverCandidate) => boolean },
): number {
  return users.filter((user) =>
    approverEligibility(rule, user, { ...claim, approvals: [] }, access ? { approverAccess: access.approverAccess, hasFinanceWrite: access.hasFinanceWrite(user) } : undefined).eligible,
  ).length;
}
