export type OrganizationKind = "society" | "corporation" | "organization";

export type LegalEntityLike = {
  _id?: unknown;
  id?: unknown;
  name?: string | null;
  legalName?: string | null;
  displayName?: string | null;
  entityType?: string | null;
  formationStatus?: string | null;
  organizationStatus?: string | null;
  kind?: string | null;
  organizationKind?: string | null;
  jurisdictionCode?: string | null;
  homeJurisdictionCode?: string | null;
  jurisdiction?: string | null;
  homeJurisdiction?: string | null;
  actFormedUnder?: string | null;
};

export type Organization = LegalEntityLike;
export type LegalEntity = LegalEntityLike;

const BC_JURISDICTIONS = new Set(["CA-BC", "british_columbia", "bc"]);
const FEDERAL_CBCA_JURISDICTIONS = new Set([
  "CA-FED-CBCA",
  "federal__canada_",
  "canada",
  "federal",
]);
const ONTARIO_OBCA_JURISDICTIONS = new Set(["CA-ON-OBCA", "ontario", "on"]);
const UNKNOWN_JURISDICTION = "unknown";

export function organizationLabel(organization?: LegalEntityLike | null): string {
  return (
    cleanText(organization?.legalName) ||
    cleanText(organization?.name) ||
    cleanText(organization?.displayName) ||
    "Organization"
  );
}

export function organizationEntityType(organization?: LegalEntityLike | null): string {
  return (
    cleanText(organization?.entityType) ||
    cleanText(organization?.kind) ||
    cleanText(organization?.organizationKind) ||
    "organization"
  );
}

export function homeJurisdictionCode(organization?: LegalEntityLike | null): string {
  return (
    cleanText(organization?.jurisdictionCode) ||
    cleanText(organization?.homeJurisdictionCode) ||
    cleanText(organization?.homeJurisdiction) ||
    cleanText(organization?.jurisdiction) ||
    UNKNOWN_JURISDICTION
  );
}

/**
 * Resolve a jurisdiction value (canonical code or registry alias such as
 * "british_columbia" / "ontario" / "federal") to its canonical code. Unknown or
 * empty values pass through unchanged so new jurisdictions work without edits here.
 */
export function canonicalizeJurisdictionCode(value?: string | null): string {
  const code = cleanText(value);
  if (!code) return UNKNOWN_JURISDICTION;
  if (BC_JURISDICTIONS.has(code)) return "CA-BC";
  if (FEDERAL_CBCA_JURISDICTIONS.has(code)) return "CA-FED-CBCA";
  if (ONTARIO_OBCA_JURISDICTIONS.has(code)) return "CA-ON-OBCA";
  return code;
}

export function organizationKind(organization?: LegalEntityLike | null): OrganizationKind {
  const entityType = organizationEntityType(organization).toLowerCase();
  const act = cleanText(organization?.actFormedUnder).toLowerCase();

  if (entityType.includes("corporation")) return "corporation";
  if (entityType.includes("society")) return "society";
  if (act.includes("societies_act")) {
    return "society";
  }
  if (entityType.includes("corporation") || act.includes("corporations_act")) {
    return "corporation";
  }
  if (isFederalCbca(organization) || isOntarioObca(organization)) {
    return "corporation";
  }
  return "organization";
}

export function isCorporation(organization?: LegalEntityLike | null): boolean {
  return organizationKind(organization) === "corporation";
}

export function isSociety(organization?: LegalEntityLike | null): boolean {
  return organizationKind(organization) === "society";
}

export function isFederalCbca(organization?: LegalEntityLike | null): boolean {
  const jurisdiction = homeJurisdictionCode(organization);
  const act = cleanText(organization?.actFormedUnder).toLowerCase();
  const entityType = organizationEntityType(organization).toLowerCase();
  return (
    jurisdiction === "CA-FED-CBCA" ||
    act === "canada_business_corporations_act" ||
    (FEDERAL_CBCA_JURISDICTIONS.has(jurisdiction) && entityType === "corporation__business_")
  );
}

export function isOntarioObca(organization?: LegalEntityLike | null): boolean {
  const jurisdiction = homeJurisdictionCode(organization);
  const act = cleanText(organization?.actFormedUnder).toLowerCase();
  const entityType = organizationEntityType(organization).toLowerCase();
  return (
    jurisdiction === "CA-ON-OBCA" ||
    act === "business_corporations_act__ontario_" ||
    (ONTARIO_OBCA_JURISDICTIONS.has(jurisdiction) && entityType === "corporation__business_")
  );
}

export function isBcSociety(organization?: LegalEntityLike | null): boolean {
  const jurisdiction = homeJurisdictionCode(organization);
  const act = cleanText(organization?.actFormedUnder).toLowerCase();
  return BC_JURISDICTIONS.has(jurisdiction) && (isSociety(organization) || act === "societies_act");
}

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Reject contradictory legal identities while retaining legacy records with missing fields. */
export function validateWorkspaceLegalIdentity(organization: LegalEntityLike & { isMemberFunded?: boolean; organizationStatus?: string; incorporationNumber?: string; incorporationDate?: string }) {
  const entityType = cleanText(organization.entityType);
  const act = cleanText(organization.actFormedUnder);
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  const corporate = entityType.includes("corporation");
  if (organization.jurisdictionCode && organization.homeJurisdictionCode && canonicalizeJurisdictionCode(organization.jurisdictionCode) !== canonicalizeJurisdictionCode(organization.homeJurisdictionCode)) {
    throw new Error("Legal jurisdiction and home jurisdiction must match. Record extra-provincial locations as separate registrations.");
  }
  if ((corporate && act === "societies_act") || (entityType === "society" && act.includes("corporations_act"))) {
    throw new Error("Entity type and governing act must describe the same legal setup.");
  }
  const actJurisdictions: Record<string, string> = {
    societies_act: "CA-BC",
    business_corporations_act__british_columbia_: "CA-BC",
    business_corporations_act: "CA-BC",
    canada_business_corporations_act: "CA-FED-CBCA",
    business_corporations_act__ontario_: "CA-ON-OBCA",
  };
  if (code !== "unknown" && actJurisdictions[act] && code !== actJurisdictions[act]) {
    throw new Error("The governing act must match the home legal jurisdiction.");
  }
  if (entityType === "society" && ["CA-FED-CBCA", "CA-ON-OBCA"].includes(code)) {
    throw new Error("This business corporation jurisdiction does not use the BC society setup.");
  }
  if (corporate && organization.isMemberFunded) {
    throw new Error("Member-funded society status does not apply to a business corporation.");
  }
  if (organization.organizationStatus === "pre_incorporation" && organization.formationStatus !== "incorporated" && (cleanText(organization.incorporationNumber) || cleanText(organization.incorporationDate))) {
    throw new Error("An organization preparing incorporation cannot already have an incorporation number or effective date. Choose already incorporated to record those details.");
  }
}

export function validateWorkspaceLegalIdentityUpdate(previous: Record<string, any> | null | undefined, patch: Record<string, any>) {
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const identityFields = ["entityType", "actFormedUnder", "jurisdictionCode", "homeJurisdictionCode", "isMemberFunded", "organizationStatus", "incorporationNumber", "incorporationDate"];
  // Imported legacy metadata can still be maintained while its unchanged legal identity is reviewed.
  if (previous && !identityFields.some((key) => key in definedPatch && definedPatch[key] !== previous[key])) return;
  validateWorkspaceLegalIdentity({ ...previous, ...definedPatch });
}
