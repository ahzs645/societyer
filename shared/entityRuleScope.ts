import { hasDeclaredJurisdiction, hasRecordedEntityType, legalGovernanceProfile } from "./legalGovernanceProfiles";
import { hasApplicablePrivacyLaw, resolvePrivacyProfile, type PrivacyLawId } from "./privacyRuleProfiles";
import {
  canonicalizeJurisdictionCode,
  DEFAULT_HOME_JURISDICTION_CODE,
  homeJurisdictionCode,
  organizationKind,
  type LegalEntityLike,
  type OrganizationKind,
} from "./organizationDomain";

/**
 * Which organizations a rule, warning or citation is written for.
 *
 * - `bc_society`: BC Societies Act / Societies Regulation (model bylaws). Only a
 *   BC society — never a corporation, and never a society formed elsewhere.
 * - `bc_organization`: BC PIPA and BC OIPC guidance. Applies only to activities assessed as
 *   covered by BC PIPA; a BC incorporation address alone is insufficient.
 * - `general`: federal or cross-entity sources (CASL, CRA, OPC). Every workspace.
 */
export type RuleAudience = "bc_society" | "bc_organization" | "general" | `governance:${string}` | `privacy:${PrivacyLawId}`;

export type OrganizationRuleScope = {
  kind: OrganizationKind;
  /** Canonical home jurisdiction; legacy records with no identity use the product default. */
  jurisdictionCode: string;
  /** No entity type was recorded; treated as the historical BC society default. */
  legacyIdentity: boolean;
  isSociety: boolean;
  isCorporation: boolean;
  /** BC Societies Act rules, warnings and citations apply. */
  isBcSociety: boolean;
  /** The home incorporation jurisdiction is BC. Privacy uses it only for the labelled BC PIPA presumption that recorded facts can displace (privacy.md TRM-7). */
  isBcHome: boolean;
};

const BC = "CA-BC";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve which rule families apply to a workspace. Unknown or missing
 * organizations get an empty scope so society-only content stays hidden while
 * the profile loads.
 */
export function organizationRuleScope(organization?: LegalEntityLike | null): OrganizationRuleScope {
  if (!organization) {
    return {
      kind: "organization",
      jurisdictionCode: "unknown",
      legacyIdentity: false,
      isSociety: false,
      isCorporation: false,
      isBcSociety: false,
      isBcHome: false,
    };
  }
  const kind = organizationKind(organization);
  const act = clean(organization.actFormedUnder).toLowerCase();
  const rawJurisdiction = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  // Only a missing or blank jurisdiction is the legacy default. A recorded
  // jurisdiction that canonicalizes to "unknown" is an affirmative review state.
  const undeclaredJurisdiction = rawJurisdiction === "unknown" && !hasDeclaredJurisdiction(organization);
  const bcOrUndeclared = rawJurisdiction === BC || undeclaredJurisdiction;
  const bcSocietyAct = act === "" || act === "societies_act";
  // Workspaces created before entity types were recorded are BC societies
  // (DEFAULT_HOME_JURISDICTION_CODE); anything with an explicit identity is not.
  const legacyIdentity = !hasRecordedEntityType(organization) && kind !== "corporation" && bcSocietyAct && bcOrUndeclared;
  const jurisdictionCode =
    undeclaredJurisdiction && (legacyIdentity || (kind === "society" && bcSocietyAct))
      ? DEFAULT_HOME_JURISDICTION_CODE
      : rawJurisdiction;
  const isSociety = kind === "society" || legacyIdentity;
  // The governance registry is the single authority for which Act applies, so
  // Societies Act warnings, inspection copy and the dashboard always agree.
  const isBcSociety = legalGovernanceProfile(organization)?.id === "bc_society";
  return {
    kind: legacyIdentity ? "society" : kind,
    jurisdictionCode,
    legacyIdentity,
    isSociety,
    isCorporation: kind === "corporation",
    isBcSociety,
    isBcHome: jurisdictionCode === BC,
  };
}

/** True when content written for `audience` applies to this organization. */
export function audienceAppliesToOrganization(audience: RuleAudience, organization?: LegalEntityLike | null): boolean {
  if (audience === "general") return true;
  const scope = organizationRuleScope(organization);
  if (audience === "bc_society") return scope.isBcSociety;
  if (audience === "bc_organization") return hasApplicablePrivacyLaw(organization, "bc_pipa");
  if (audience.startsWith("governance:")) return legalGovernanceProfile(organization)?.id === audience.slice(11);
  if (audience.startsWith("privacy:")) return hasApplicablePrivacyLaw(organization, audience.slice(8) as PrivacyLawId);
  return false;
}

/** BC Societies Act warnings, rules and citations apply. */
export function appliesBcSocietyRules(organization?: LegalEntityLike | null): boolean {
  return organizationRuleScope(organization).isBcSociety;
}

/** BC PIPA (private-sector privacy) rules and citations apply. */
export function appliesBcPrivacyRules(organization?: LegalEntityLike | null): boolean {
  return hasApplicablePrivacyLaw(organization, "bc_pipa");
}

/**
 * Short description of the automated checks that run for this organization, for
 * compliance card subtitles. Never names a statute that does not apply.
 */
export function automatedComplianceChecksLabel(organization?: LegalEntityLike | null): string {
  const profile = legalGovernanceProfile(organization);
  const privacy = resolvePrivacyProfile(organization);
  if (!organization) return "Loading the organization’s legal profile";
  const governance = profile ? `${profile.name}: configured governance evidence checks` : "Governing Act requires a reviewed profile";
  return `${governance}; ${privacy.applicableLawIds.length ? privacy.label : "privacy applicability needs assessment"}`;
}
