/**
 * Entity-aware UI wording for every page and the app chrome.
 *
 * A workspace can be a BC society, a business corporation (BC, CBCA, OBCA) or a
 * custom existing entity. Society-only terms (members, the AGM, the
 * constitution, the Societies Act) must not leak into other workspaces.
 *
 * Which rules apply comes from `organizationRuleScope` (shared/entityRuleScope.ts),
 * the single source of truth: a legacy record with no recorded identity keeps
 * the historical BC society wording, and while the workspace is loading every
 * flag is false so society-only content stays hidden rather than flashing.
 *
 * This module only chooses labels for concepts the repo already models. It
 * never supplies statute citations: a page that shows a Societies Act section
 * gates it on `societyLaw` (or `appliesBcSocietyRules`) and hides it otherwise
 * rather than guessing an equivalent.
 *
 * `governanceVocabulary.ts` and `organizationCopy.ts` are kept as thin
 * re-exports of the two older projections below; new code imports
 * `organizationVocabulary` from here.
 */
import { organizationRuleScope } from "../../shared/entityRuleScope";
import { PRIVACY_LAWS, resolvePrivacyProfile, type PrivacyLawId } from "../../shared/privacyRuleProfiles";
import { legalGovernanceProfile } from "../../shared/legalGovernanceProfiles";
import type { LegalEntityLike, OrganizationKind } from "../../shared/organizationDomain";

export type OrganizationVocabulary = {
  kind: OrganizationKind;
  /** Canonical home jurisdiction ("CA-BC", "CA-FED-CBCA", …, or "unknown"). */
  jurisdictionCode: string;
  isSociety: boolean;
  isCorporation: boolean;
  /** BC Societies Act references (sections, Societies Online, BC-SOC citations) may be shown. */
  societyLaw: boolean;
  /** Home incorporation jurisdiction is BC; privacy depends on the activity assessment. */
  bcHome: boolean;
  /** BC company: the articles take the place of separate by-laws. */
  bcCompany: boolean;
  /** Lower-case noun: "society" | "corporation" | "organization". */
  organizationNoun: string;
  /** Title-case noun: "Society" | "Corporation" | "Organization". */
  organizationTitle: string;
  /** Person who votes at a general meeting: "member" or "shareholder". */
  voterNoun: string;
  voterNounPlural: string;
  /**
   * People a communication or contact preference is about. Societies keep the
   * member register; a corporation's member table only holds contact records.
   */
  contactNoun: string;
  contactNounPlural: string;
  /** Short annual meeting label: "AGM" / "annual meeting". */
  annualMeeting: string;
  /** Sentence-start annual meeting label. */
  annualMeetingTitle: string;
  /**
   * Formal meeting name for minutes and notices. Societies and BC companies hold
   * an "Annual General Meeting" (the Societies Act and the BC Business
   * Corporations Act both use that term); other corporations and custom
   * entities hold an "Annual Meeting".
   */
  annualMeetingFormal: string;
  /** Governing documents, lower case: "constitution and bylaws" / "articles and by-laws". */
  governingDocuments: string;
  /** Governing documents, sentence start. */
  governingDocumentsTitle: string;
  /** Privacy page and nav label: names PIPA only where BC PIPA applies. */
  privacyLabel: string;
  /** The rules document: "bylaws" (society), "articles" (BC company), "by-laws" (other corporations). */
  bylawsNoun: string;
  bylawsTitle: string;
  /** "bylaw amendment", "by-law amendment" or "alteration to the articles". */
  bylawAmendmentNoun: string;
};

/** Nav/page label: "Privacy (PIPA)" when BC PIPA alone applies (including the
 * BC-home presumption), the applicable laws when several apply, else neutral. */
function privacyNavLabel(lawIds: readonly PrivacyLawId[]): string {
  if (!lawIds.length) return "Privacy";
  if (lawIds.length === 1 && lawIds[0] === "bc_pipa") return "Privacy (PIPA)";
  return `Privacy (${lawIds.map((id) => PRIVACY_LAWS[id].label).join(" + ")})`;
}

export function organizationVocabulary(organization?: LegalEntityLike | null): OrganizationVocabulary {
  const scope = organizationRuleScope(organization);
  const bcCompany = legalGovernanceProfile(organization)?.id === "bc_company";
  const privacy = resolvePrivacyProfile(organization);
  const common = {
    kind: scope.kind,
    jurisdictionCode: scope.jurisdictionCode,
    isSociety: scope.isSociety,
    isCorporation: scope.isCorporation,
    societyLaw: scope.isBcSociety,
    bcHome: scope.isBcHome,
    bcCompany,
    privacyLabel: privacyNavLabel(privacy.applicableLawIds),
  };
  if (scope.isSociety) {
    return {
      ...common,
      organizationNoun: "society",
      organizationTitle: "Society",
      voterNoun: "member",
      voterNounPlural: "members",
      contactNoun: "member",
      contactNounPlural: "members",
      annualMeeting: "AGM",
      annualMeetingTitle: "AGM",
      annualMeetingFormal: "Annual General Meeting",
      governingDocuments: "constitution and bylaws",
      governingDocumentsTitle: "Constitution and bylaws",
      bylawsNoun: "bylaws",
      bylawsTitle: "Bylaws",
      bylawAmendmentNoun: "bylaw amendment",
    };
  }
  if (scope.isCorporation) {
    return {
      ...common,
      organizationNoun: "corporation",
      organizationTitle: "Corporation",
      voterNoun: "shareholder",
      voterNounPlural: "shareholders",
      contactNoun: "contact",
      contactNounPlural: "contacts",
      annualMeeting: "annual meeting",
      annualMeetingTitle: "Annual meeting",
      annualMeetingFormal: bcCompany ? "Annual General Meeting" : "Annual Meeting",
      governingDocuments: bcCompany ? "articles" : "articles and by-laws",
      governingDocumentsTitle: bcCompany ? "Articles" : "Articles and by-laws",
      bylawsNoun: bcCompany ? "articles" : "by-laws",
      bylawsTitle: bcCompany ? "Articles" : "By-laws",
      bylawAmendmentNoun: bcCompany ? "alteration to the articles" : "by-law amendment",
    };
  }
  return {
    ...common,
    organizationNoun: "organization",
    organizationTitle: "Organization",
    voterNoun: "member",
    voterNounPlural: "members",
    contactNoun: "contact",
    contactNounPlural: "contacts",
    annualMeeting: "annual meeting",
    annualMeetingTitle: "Annual meeting",
    annualMeetingFormal: "Annual Meeting",
    governingDocuments: "governing documents",
    governingDocumentsTitle: "Governing documents",
    bylawsNoun: "governing documents",
    bylawsTitle: "Governing documents",
    bylawAmendmentNoun: "governing-document amendment",
  };
}

export function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// ---------------------------------------------------------------------------
// Older projections, kept so existing imports keep their names and shapes.
// ---------------------------------------------------------------------------

/** Governance and people wording (formerly `governanceVocabulary.ts`). */
export type GovernanceVocabulary = Pick<
  OrganizationVocabulary,
  "kind" | "isSociety" | "isCorporation" | "societyLaw" | "organizationNoun" | "voterNoun" | "voterNounPlural"
>;

export function governanceVocabulary(organization?: LegalEntityLike | null): GovernanceVocabulary {
  const vocab = organizationVocabulary(organization);
  return {
    kind: vocab.kind,
    isSociety: vocab.isSociety,
    isCorporation: vocab.isCorporation,
    societyLaw: vocab.societyLaw,
    organizationNoun: vocab.organizationNoun,
    voterNoun: vocab.voterNoun,
    voterNounPlural: vocab.voterNounPlural,
  };
}

/** Operations-page wording (formerly `organizationCopy.ts`). */
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
  const vocab = organizationVocabulary(organization);
  return {
    society: vocab.isSociety,
    bcSociety: vocab.societyLaw,
    corporation: vocab.isCorporation,
    bcCompany: vocab.bcCompany,
    entityNoun: vocab.organizationNoun,
    entityTitle: vocab.organizationTitle,
    annualMeeting: vocab.annualMeeting,
    annualMeetingTitle: vocab.annualMeetingTitle,
    governingDocuments: vocab.governingDocuments,
    governingDocumentsTitle: vocab.governingDocumentsTitle,
  };
}
