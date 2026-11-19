import { governingDocumentSlots } from "../../../shared/governingDocuments";
import { legalGovernanceProfile, requiredResidentCanadianDirectors } from "../../../shared/legalGovernanceProfiles";
import { isCorporation, isPreparingIncorporation, type LegalEntityLike } from "../../../shared/organizationDomain";
import { optionLabel } from "../../lib/orgHubOptions";
import { isExtraProvincialRegistration } from "./detailRows";
import type { AddressRow, IdentifierRow, ProfileTab, RegistrationRow } from "./types";

/** Where an attention item sends people: a profile tab (and section), or another page. */
export type AttentionTarget = { tab: ProfileTab; anchor?: string } | { href: string };

export type AttentionItem = {
  id: string;
  text: string;
  /** The action's label, e.g. "Add the address". */
  action: string;
  target: AttentionTarget;
};

export type AttentionOrganization = LegalEntityLike & {
  fiscalYearEnd?: string;
  craBnStatus?: string;
  corporationKeyVaultItemId?: string;
  registeredOfficeAddress?: string;
  constitutionDocId?: string;
  bylawsDocId?: string;
  distributing?: boolean;
  legalSubtype?: string;
  isMemberFunded?: boolean;
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

  for (const row of detail.registrations) {
    if (!isExtraProvincialRegistration(row) || row.status === "inactive" || row.registrationNumber?.trim()) continue;
    items.push({ id: `registration-number-missing:${row._id}`, text: `The ${optionLabel("entityJurisdictions", row.jurisdiction)} extra-provincial registration has no number.`, action: "Add the number", target: { tab: "registrations" } });
  }

  for (const slot of governingDocumentSlots(org)) {
    if (org[slot.field]) continue;
    items.push({ id: `governing-document-missing:${slot.field}`, text: `${slot.label} ${slot.label.endsWith("s") ? "are" : "is"} not on file.`, action: "Add", target: { tab: "documents" } });
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
