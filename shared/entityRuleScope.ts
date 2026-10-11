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
 * - `bc_organization`: BC private-sector law that is not entity-specific (PIPA,
 *   BC OIPC guidance). Any organization whose home jurisdiction is BC.
 * - `general`: federal or cross-entity sources (CASL, CRA, OPC). Every workspace.
 */
export type RuleAudience = "bc_society" | "bc_organization" | "general";

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
  /** BC private-sector rules (PIPA) apply because the home jurisdiction is BC. */
  isBcHome: boolean;
};

const BC = "CA-BC";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasRecordedEntityType(organization: LegalEntityLike): boolean {
  return Boolean(clean(organization.entityType) || clean(organization.kind) || clean(organization.organizationKind));
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
  const bcOrUnknown = rawJurisdiction === BC || rawJurisdiction === "unknown";
  const bcSocietyAct = act === "" || act === "societies_act";
  // Workspaces created before entity types were recorded are BC societies
  // (DEFAULT_HOME_JURISDICTION_CODE); anything with an explicit identity is not.
  const legacyIdentity = !hasRecordedEntityType(organization) && kind !== "corporation" && bcSocietyAct && bcOrUnknown;
  const jurisdictionCode =
    rawJurisdiction === "unknown" && (legacyIdentity || (kind === "society" && bcSocietyAct))
      ? DEFAULT_HOME_JURISDICTION_CODE
      : rawJurisdiction;
  const isSociety = kind === "society" || legacyIdentity;
  const isBcSociety = isSociety && jurisdictionCode === BC && bcSocietyAct;
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
  return scope.isBcHome;
}

/** BC Societies Act warnings, rules and citations apply. */
export function appliesBcSocietyRules(organization?: LegalEntityLike | null): boolean {
  return organizationRuleScope(organization).isBcSociety;
}

/** BC PIPA (private-sector privacy) rules and citations apply. */
export function appliesBcPrivacyRules(organization?: LegalEntityLike | null): boolean {
  return organizationRuleScope(organization).isBcHome;
}

/**
 * Short description of the automated checks that run for this organization, for
 * compliance card subtitles. Never names a statute that does not apply.
 */
export function automatedComplianceChecksLabel(organization?: LegalEntityLike | null): string {
  const scope = organizationRuleScope(organization);
  if (scope.isBcSociety) return "Automated checks against the Societies Act and BC PIPA";
  if (scope.isBcHome) return "Automated BC PIPA privacy checks; corporate-law checks are not automated yet";
  return "No automated statutory checks are configured for this entity and jurisdiction yet";
}
