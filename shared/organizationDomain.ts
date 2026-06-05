export type OrganizationKind = "society" | "corporation" | "organization";

export type LegalEntityLike = {
  _id?: unknown;
  id?: unknown;
  name?: string | null;
  legalName?: string | null;
  displayName?: string | null;
  entityType?: string | null;
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

export function organizationKind(organization?: LegalEntityLike | null): OrganizationKind {
  const entityType = organizationEntityType(organization).toLowerCase();
  const act = cleanText(organization?.actFormedUnder).toLowerCase();

  if (entityType.includes("society") || act.includes("societies_act")) {
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
