import { canonicalizeJurisdictionCode, type OrganizationKind } from "./organizationDomain";

/**
 * Statutory governance rules for an organization's director register, expressed as
 * data instead of jurisdiction `if`-branches. To support a new jurisdiction's director
 * rules, add a row to DIRECTOR_GOVERNANCE_RULES keyed by `<canonical jurisdiction>:<kind>`
 * — see CONTRIBUTING.md → "Adding a jurisdiction or entity type".
 */
export type DirectorGovernanceRule = {
  /** Minimum number of active directors the statute requires, if any. */
  minimumActiveDirectors?: number;
  /** Whether at least one resident director is required (residency basis is jurisdiction copy). */
  requiresResidentDirector: boolean;
  /** Whether the Directors workspace should surface a per-director residency field. */
  trackResidentDirectorField: boolean;
  /** Register subtitle shown at the top of the Directors workspace. */
  subtitle: string;
  /** Short subtext under the active-directors metric. */
  activeDirectorsSubtext: string;
};

const CORPORATION_DEFAULT_RULE: DirectorGovernanceRule = {
  requiresResidentDirector: false,
  trackResidentDirectorField: false,
  subtitle:
    "Director register for the corporation workspace. Review the governing statute, articles, by-laws, consents, and registry notices for each change.",
  activeDirectorsSubtext: "Review governing statute, articles, and by-laws.",
};

const ORGANIZATION_DEFAULT_RULE: DirectorGovernanceRule = {
  requiresResidentDirector: false,
  trackResidentDirectorField: false,
  subtitle:
    "Director or governing-person register for this organization. Review the governing statute, formation documents, consents, and registry notices for each change.",
  activeDirectorsSubtext: "Review governing documents and applicable law.",
};

/** Keyed `<canonical jurisdiction code>:<OrganizationKind>`. */
const DIRECTOR_GOVERNANCE_RULES: Record<string, DirectorGovernanceRule> = {
  "CA-BC:society": {
    minimumActiveDirectors: 3,
    requiresResidentDirector: true,
    trackResidentDirectorField: true,
    subtitle:
      "Register of directors under BC Societies Act s.20. Section 40 requires at least 3 directors and at least 1 BC resident unless the s.197 member-funded exception applies.",
    activeDirectorsSubtext: "Minimum 3 for regular societies.",
  },
};

/** Resolve the director governance rule for a jurisdiction + organization kind. */
export function directorGovernanceRule(
  jurisdictionCode: string | null | undefined,
  kind: OrganizationKind,
): DirectorGovernanceRule {
  const key = `${canonicalizeJurisdictionCode(jurisdictionCode)}:${kind}`;
  const exact = DIRECTOR_GOVERNANCE_RULES[key];
  if (exact) return exact;
  if (kind === "corporation") return CORPORATION_DEFAULT_RULE;
  return ORGANIZATION_DEFAULT_RULE;
}
