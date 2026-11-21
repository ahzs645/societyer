import { governingDocumentSlots } from "../../../shared/governingDocuments";
import { hasIdentifiedEvidence, type EvidenceFacts } from "../../../shared/governingDocumentEvidence";
import { legalGovernanceProfile, requiredResidentCanadianDirectors } from "../../../shared/legalGovernanceProfiles";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isCorporation, isPreparingIncorporation, type LegalEntityLike } from "../../../shared/organizationDomain";
import { optionLabel } from "../../lib/orgHubOptions";
import { isExtraProvincialRegistration } from "./detailRows";
import { listText, registrationGaps } from "./registryFacts";
import type { AddressRow, IdentifierRow, ProfileTab, RegistrationRow } from "./types";

/** Profile drawers an attention item can open. */
export type AttentionAction = "registry-import";

/** Where an attention item sends people: a profile tab (and section), another page, or a drawer. */
export type AttentionTarget = { tab: ProfileTab; anchor?: string } | { href: string } | { action: AttentionAction };

export type AttentionItem = {
  id: string;
  text: string;
  /** The action's label, e.g. "Add the address". */
  action: string;
  target: AttentionTarget;
};

export type AttentionOrganization = LegalEntityLike & Pick<EvidenceFacts, "governingDocumentEvidence"> & {
  fiscalYearEnd?: string;
  craBnStatus?: string;
  corporationKeyVaultItemId?: string;
  registeredOfficeAddress?: string;
  constitutionDocId?: string;
  bylawsDocId?: string;
  distributing?: boolean;
  legalSubtype?: string;
  isMemberFunded?: boolean;
  articlesMinDirectors?: number;
  articlesMaxDirectors?: number;
  articlesShareTransferRestrictions?: string;
  articlesBusinessRestrictions?: string;
  articlesOtherProvisions?: string;
  articlesSourceDocumentId?: string;
};

export type AttentionDirector = { status?: string; residentCanadianStatus?: string };

export type AttentionDetail = {
  addresses: readonly AddressRow[];
  registrations: readonly RegistrationRow[];
  identifiers: readonly IdentifierRow[];
  /** The directors register; leave it out when it is not loaded or not readable. */
  directors?: readonly AttentionDirector[];
};

/**
 * What the organization profile is missing or has out of date, from saved
 * data only. Pure: the Overview tab lists these under "Needs attention".
 */
export function organizationProfileAttention(org: AttentionOrganization, detail: AttentionDetail): AttentionItem[] {
  const items: AttentionItem[] = [];
  const preparing = isPreparingIncorporation(org);

  const offices = detail.addresses.filter((row) => row.type === "registered_office");
  if (!offices.length && !org.registeredOfficeAddress?.trim()) {
    items.push({ id: "registered-office-missing", text: "No registered office is recorded.", action: "Add the address", target: { tab: "offices", anchor: "registered-office" } });
  } else if (!preparing && offices.length && offices.every((row) => row.status === "proposed")) {
    items.push({ id: "registered-office-proposed", text: "The registered office is still marked Proposed. Make it current from the incorporation date.", action: "Update the address", target: { tab: "offices", anchor: "registered-office" } });
  }

  if (org.craBnStatus === "confirmed" && !detail.identifiers.some((row) => row.kind === "business_number")) {
    items.push({ id: "business-number-missing", text: "The business number is confirmed, but the number itself is not recorded.", action: "Add the BN", target: { tab: "tax" } });
  }

  if (!org.fiscalYearEnd) {
    items.push({ id: "fiscal-year-end-missing", text: "Set the fiscal year end. Tax and annual deadlines depend on it.", action: "Set it", target: { tab: "legal", anchor: "business-year" } });
  }

  if (isCorporation(org) && !preparing && !org.corporationKeyVaultItemId) {
    items.push({ id: "corporation-key-missing", text: "Store the corporation key in Access custody.", action: "Open Access custody", target: { href: "/app/access-custody" } });
  }

  // A federal corporation's Corporations Canada (and BC Registries) documents fill the number, articles, registrations and addresses.
  const readableRegistry = canonicalizeJurisdictionCode(homeJurisdictionCode(org)) === "CA-FED-CBCA";
  const imported = Boolean(org.articlesSourceDocumentId) || detail.registrations.some((row) => row.certificateDocumentId || row.sourceDocumentIds?.length);
  if (isCorporation(org) && readableRegistry && org.formationStatus !== "preparing" && !imported) {
    items.push({ id: "registry-import", text: org.formationStatus === "submitted"
      ? "Got the certificate? Import the registry documents to record the incorporation and fill the profile."
      : "Import the registry documents to fill the articles, registrations and addresses from the filed copies.", action: "Import documents", target: { action: "registry-import" } });
  }

  if (isCorporation(org) && !preparing && !articlesRecorded(org)) {
    items.push({ id: "articles-missing", text: "The articles are not recorded: director limits, share transfer and business restrictions.", action: "Record the articles", target: { tab: "legal", anchor: "articles" } });
  }

  for (const row of detail.registrations) {
    if (!isExtraProvincialRegistration(row) || row.status === "inactive") continue;
    const place = optionLabel("entityJurisdictions", row.jurisdiction);
    if (!row.registrationNumber?.trim()) {
      items.push({ id: `registration-number-missing:${row._id}`, text: `The ${place} extra-provincial registration has no number.`, action: "Add the number", target: { tab: "registrations" } });
      continue;
    }
    const gaps = registrationGaps(row);
    if (gaps.length) items.push({ id: `registration-details-missing:${row._id}`, text: `The ${place} extra-provincial registration has no ${listText(gaps)} recorded.`, action: "Complete it", target: { tab: "registrations" } });
  }

  for (const slot of governingDocumentSlots(org)) {
    // Uploaded, or recorded as held elsewhere (external system or physical records).
    if (hasIdentifiedEvidence(org, slot.field)) continue;
    items.push({ id: `governing-document-missing:${slot.field}`, text: slot.label.endsWith("s") ? `${slot.label} aren't identified yet. Upload a copy or record where they're held.` : `${slot.label} isn't identified yet. Upload a copy or record where it's held.`, action: "Add", target: { tab: "documents", anchor: "governing-documents" } });
  }

  const residency = legalGovernanceProfile(org)?.directors.residency;
  const active = detail.directors?.filter((director) => director.status === "Active");
  if (residency === "canadian_25_percent" && active?.length) {
    const required = requiredResidentCanadianDirectors(active.length);
    const confirmed = active.filter((director) => director.residentCanadianStatus === "yes").length;
    if (confirmed < required) {
      items.push({ id: "resident-canadian-directors", text: `${confirmed} of ${active.length} directors ${confirmed === 1 ? "is a" : "are"} confirmed resident Canadian${confirmed === 1 ? "" : "s"}; at least ${required} needed.`, action: "Review directors", target: { href: "/app/directors" } });
    }
  }

  return items;
}

/** Any of the filed articles' provisions, or their source document, is on the profile. */
export function articlesRecorded(org: AttentionOrganization) {
  return org.articlesMinDirectors !== undefined || org.articlesMaxDirectors !== undefined || Boolean(org.articlesSourceDocumentId)
    || [org.articlesShareTransferRestrictions, org.articlesBusinessRestrictions, org.articlesOtherProvisions].some((value) => Boolean(value?.trim()));
}
