/**
 * Entity-aware UI wording for operations pages and app chrome.
 *
 * A workspace can be a BC society, a business corporation (BC, CBCA, OBCA) or a
 * custom existing entity. Society-only terms — members, the AGM, the
 * constitution — must not leak into other workspaces. Which rules apply comes
 * from `organizationRuleScope` (shared/entityRuleScope.ts), so a legacy record
 * with no recorded identity keeps the historical BC society wording.
 *
 * This file only chooses labels for concepts the repo already models. It never
 * supplies statute citations: a page that shows a Societies Act section should
 * gate it on `appliesBcSocietyRules` and hide it otherwise rather than guess an
 * equivalent.
 */
import { canonicalizeJurisdictionCode, homeJurisdictionCode, type LegalEntityLike } from "../../shared/organizationDomain";
import { organizationRuleScope } from "../../shared/entityRuleScope";

export type OrganizationCopy = {
  /** Society vocabulary applies (members, AGM, constitution and bylaws). */
  society: boolean;
  /** BC Societies Act duties and citations apply. */
  bcSociety: boolean;
  corporation: boolean;
  /** BC company: the articles take the place of separate by-laws. */
  bcCompany: boolean;
  /** Lower-case noun: "society" / "corporation" / "organization". */
  entityNoun: string;
  /** Title-case noun. */
  entityTitle: string;
  /** Short annual meeting label: "AGM" / "annual meeting". */
  annualMeeting: string;
  /** Title-case annual meeting label. */
  annualMeetingTitle: string;
  /** Governing documents, lower case: "constitution and bylaws" / "articles and by-laws". */
  governingDocuments: string;
  /** Governing documents, sentence start. */
  governingDocumentsTitle: string;
};

export function organizationCopy(organization?: LegalEntityLike | null): OrganizationCopy {
  const scope = organizationRuleScope(organization);
  if (scope.isSociety) {
    return {
      society: true,
      bcSociety: scope.isBcSociety,
      corporation: false,
      bcCompany: false,
      entityNoun: "society",
      entityTitle: "Society",
      annualMeeting: "AGM",
      annualMeetingTitle: "AGM",
      governingDocuments: "constitution and bylaws",
      governingDocumentsTitle: "Constitution and bylaws",
    };
  }
  if (scope.isCorporation) {
    const bcCompany = canonicalizeJurisdictionCode(homeJurisdictionCode(organization)) === "CA-BC";
    return {
      society: false,
      bcSociety: false,
      corporation: true,
      bcCompany,
      entityNoun: "corporation",
      entityTitle: "Corporation",
      annualMeeting: "annual meeting",
      annualMeetingTitle: "Annual meeting",
      governingDocuments: bcCompany ? "articles" : "articles and by-laws",
      governingDocumentsTitle: bcCompany ? "Articles" : "Articles and by-laws",
    };
  }
  return {
    society: false,
    bcSociety: false,
    corporation: false,
    bcCompany: false,
    entityNoun: "organization",
    entityTitle: "Organization",
    annualMeeting: "annual meeting",
    annualMeetingTitle: "Annual meeting",
    governingDocuments: "governing documents",
    governingDocumentsTitle: "Governing documents",
  };
}
