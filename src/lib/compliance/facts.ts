import {
  homeJurisdictionCode,
  organizationEntityType,
  organizationLabel,
} from "../../../shared/organizationDomain";
import type { ComplianceFacts } from "./engine";

export type RegistrationComplianceSource = {
  _id?: string;
  registrationType?: string | null;
  jurisdiction?: string | null;
  homeJurisdiction?: string | null;
  corporationClass?: string | null;
  entitySubtype?: string | null;
  assumedName?: string | null;
  registrationNumber?: string | null;
  registrationDate?: string | null;
  activityCommencementDate?: string | null;
  deRegistrationDate?: string | null;
  annualReturnDueDate?: string | null;
  status?: string | null;
};

export function complianceFactsForOrganization(
  organization: any,
  options: {
    asOfDate?: string;
    registrations?: RegistrationComplianceSource[];
  } = {},
): ComplianceFacts[] {
  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);
  const entityType = organizationEntityType(organization);
  const homeJurisdiction = homeJurisdictionCode(organization);
  const homeFacts: ComplianceFacts = {
    jurisdictionCode: homeJurisdiction,
    entityType,
    entitySubtype: cleanText(organization.entitySubtype) || cleanText(organization.subtype) || undefined,
    homeJurisdictionCode: homeJurisdiction,
    contextKind: "home",
    registrationType: "home",
    status: cleanText(organization.status) || undefined,
    asOfDate,
    incorporationDate: organization.incorporationDate,
    anniversaryDate: organization.anniversaryDate ?? organization.incorporationDate,
    fiscalYearEnd: fiscalYearEndDateForCurrentCycle(organization.fiscalYearEnd, asOfDate),
    eventDates: organizationEventDates(organization),
    contextLabel: organizationLabel(organization),
  };

  const registrationFacts = (options.registrations ?? [])
    .filter((registration) => registrationIsComplianceRelevant(registration))
    .map((registration) => complianceFactsForRegistration(organization, registration, asOfDate))
    .filter((facts): facts is ComplianceFacts => Boolean(facts));

  return [homeFacts, ...registrationFacts];
}

export function fiscalYearEndDateForCurrentCycle(fiscalYearEnd?: string | null, asOfDate = new Date().toISOString().slice(0, 10)) {
  if (!fiscalYearEnd) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fiscalYearEnd)) return fiscalYearEnd;
  if (!/^\d{2}-\d{2}$/.test(fiscalYearEnd)) return undefined;
  const currentYear = Number(asOfDate.slice(0, 4));
  const candidate = `${currentYear}-${fiscalYearEnd}`;
  return candidate > asOfDate ? `${currentYear - 1}-${fiscalYearEnd}` : candidate;
}

function complianceFactsForRegistration(
  organization: any,
  registration: RegistrationComplianceSource,
  asOfDate: string,
): ComplianceFacts | null {
  const jurisdictionCode = registrationJurisdictionCode(registration.jurisdiction);
  if (!jurisdictionCode) return null;
  const registrationAnchor = registration.registrationDate ?? registration.activityCommencementDate ?? organization.incorporationDate;
  return {
    jurisdictionCode,
    entityType: organizationEntityType(organization),
    entitySubtype: cleanText(registration.entitySubtype) || cleanText(organization.entitySubtype) || undefined,
    homeJurisdictionCode: registrationJurisdictionCode(registration.homeJurisdiction) ?? homeJurisdictionCode(organization),
    contextKind: registrationTypeToContextKind(registration.registrationType),
    registrationType: registration.registrationType ?? "extra_provincial",
    corporationClass: registration.corporationClass ?? undefined,
    status: registration.status ?? undefined,
    asOfDate,
    incorporationDate: registrationAnchor,
    anniversaryDate: registration.annualReturnDueDate ?? registrationAnchor,
    fiscalYearEnd: fiscalYearEndDateForCurrentCycle(organization.fiscalYearEnd, asOfDate),
    registrationDate: registration.registrationDate ?? undefined,
    commencedBusinessDate: registration.activityCommencementDate ?? undefined,
    eventDates: {
      registrationDate: registration.registrationDate ?? undefined,
      activityCommencementDate: registration.activityCommencementDate ?? undefined,
      commencedBusinessDate: registration.activityCommencementDate ?? undefined,
      annualReturnDueDate: registration.annualReturnDueDate ?? undefined,
      lastAnnualReturnFiledDate: (registration as any).lastAnnualReturnFiledDate ?? undefined,
    },
    contextKey: `registration:${registration._id ?? jurisdictionCode}`,
    contextLabel: [
      registration.assumedName || registrationNumberLabel(registration) || jurisdictionCode,
      registration.registrationType === "extra_provincial" ? "extra-provincial" : undefined,
    ].filter(Boolean).join(" · "),
    sourceRegistrationId: registration._id,
  };
}

function registrationIsComplianceRelevant(registration: RegistrationComplianceSource) {
  if (registration.status === "inactive") return false;
  if (registration.deRegistrationDate) return false;
  const type = registration.registrationType ?? "extra_provincial";
  return type !== "home" && type !== "business_name" && type !== "licence" && type !== "deregistered";
}

function registrationTypeToContextKind(registrationType?: string | null): ComplianceFacts["contextKind"] {
  if (registrationType === "branch") return "branch";
  if (registrationType === "business_name") return "business_name";
  return "extra_provincial";
}

function registrationJurisdictionCode(value?: string | null) {
  if (!value) return null;
  if (value === "CA-BC" || value === "british_columbia") return "CA-BC";
  if (value === "CA-ON-OBCA" || value === "ontario") return "CA-ON-OBCA";
  if (value === "CA-FED-CBCA" || value === "federal__canada_") return "CA-FED-CBCA";
  return null;
}

function registrationNumberLabel(registration: RegistrationComplianceSource) {
  return registration.registrationNumber ? `${registration.jurisdiction ?? "registration"} ${registration.registrationNumber}` : null;
}

function organizationEventDates(organization: any): Record<string, string | undefined> {
  return {
    iscChangeDate: cleanText(organization.iscChangeDate) || cleanText(organization.lastIscChangeDate) || undefined,
    directorChangeDate: cleanText(organization.directorChangeDate) || cleanText(organization.lastDirectorChangeDate) || undefined,
    registeredOfficeChangeDate:
      cleanText(organization.registeredOfficeChangeDate) ||
      cleanText(organization.lastRegisteredOfficeChangeDate) ||
      undefined,
    noAgmCalendarYearEnd: cleanText(organization.noAgmCalendarYearEnd) || undefined,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
