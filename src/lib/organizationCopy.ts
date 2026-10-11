/**
 * Entity-aware UI wording for operations pages and app chrome.
 *
 * A workspace can be a BC society or a business corporation (BC, CBCA, OBCA).
 * Society-only terms — the Societies Act, members, the AGM, the constitution —
 * must not leak into a corporation workspace. Only corporations switch to the
 * corporate wording here; societies and legacy/unknown records keep the
 * original society wording so nothing changes for existing society workspaces.
 *
 * This file only chooses labels for concepts the repo already models. It never
 * supplies statute citations: a page that shows a Societies Act section should
 * hide it for corporations rather than guess the corporate equivalent.
 */
import {
  canonicalizeJurisdictionCode,
  homeJurisdictionCode,
  isCorporation,
  type LegalEntityLike,
} from "../../shared/organizationDomain";

export type OrganizationCopy = {
  corporation: boolean;
  /** BC company: the articles take the place of separate by-laws. */
  bcCompany: boolean;
  /** Lower-case noun: "society" / "corporation". */
  entityNoun: string;
  /** Title-case noun: "Society" / "Corporation". */
  entityTitle: string;
  /** Short annual meeting label: "AGM" / "annual meeting". */
  annualMeeting: string;
  /** Title-case annual meeting label. */
  annualMeetingTitle: string;
  /** Governing documents, lower case: "constitution and bylaws" / "articles and by-laws". */
  governingDocuments: string;
  /** Governing documents, sentence start. */
  governingDocumentsTitle: string;
  /** People who hold the vote: "members" / "shareholders". */
  owners: string;
  /** Title-case owners noun. */
  ownersTitle: string;
};

export function organizationCopy(organization?: LegalEntityLike | null): OrganizationCopy {
  const corporation = isCorporation(organization);
  const bcCompany = corporation && canonicalizeJurisdictionCode(homeJurisdictionCode(organization)) === "CA-BC";
  if (!corporation) {
    return {
      corporation: false,
      bcCompany: false,
      entityNoun: "society",
      entityTitle: "Society",
      annualMeeting: "AGM",
      annualMeetingTitle: "AGM",
      governingDocuments: "constitution and bylaws",
      governingDocumentsTitle: "Constitution and bylaws",
      owners: "members",
      ownersTitle: "Members",
    };
  }
  return {
    corporation: true,
    bcCompany,
    entityNoun: "corporation",
    entityTitle: "Corporation",
    annualMeeting: "annual meeting",
    annualMeetingTitle: "Annual meeting",
    governingDocuments: bcCompany ? "articles" : "articles and by-laws",
    governingDocumentsTitle: bcCompany ? "Articles" : "Articles and by-laws",
    owners: "shareholders",
    ownersTitle: "Shareholders",
  };
}
