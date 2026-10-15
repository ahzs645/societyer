/**
 * Governing documents kept on the organization profile.
 *
 * A society keeps its constitution and bylaws; a corporation its articles
 * (or the certificate they come with) and by-laws; a BC company its articles
 * only. Each one is a profile field that points at a document in the same
 * workspace. Uploading or re-filing a document under a matching category fills
 * an empty field; people can also choose any document for a field from the
 * profile.
 */
import {
  documentCategoryLabel,
  governanceSlotForCategory,
  type DocumentCategoryAudience,
} from "./documentCategories";
import { isCorporation, type LegalEntityLike } from "./organizationDomain";
import { legalGovernanceProfile } from "./legalGovernanceProfiles";

export const GOVERNING_DOCUMENT_FIELDS = ["constitutionDocId", "bylawsDocId"] as const;
export type GoverningDocumentField = (typeof GOVERNING_DOCUMENT_FIELDS)[number];

export type GoverningDocumentSlot = {
  field: GoverningDocumentField;
  /** Profile row label: "Articles", "By-laws", "Constitution", "Bylaws". */
  label: string;
  /** In a sentence: "the articles", "the constitution". */
  phrase: string;
  /** The category a document gets when it is filed as this document. */
  category: string;
  /** That category's label for this organization ("Articles of incorporation"). */
  categoryLabel: string;
};

export function governingDocumentAudience(organization?: LegalEntityLike | null): DocumentCategoryAudience {
  return {
    corporation: isCorporation(organization),
    bcCompany: legalGovernanceProfile(organization)?.id === "bc_company",
  };
}

/** The governing-document fields this organization's profile shows, in order. */
export function governingDocumentSlots(organization?: LegalEntityLike | null): GoverningDocumentSlot[] {
  const audience = governingDocumentAudience(organization);
  const slot = (field: GoverningDocumentField, label: string, phrase: string, category: string): GoverningDocumentSlot =>
    ({ field, label, phrase, category, categoryLabel: documentCategoryLabel(category, audience) });
  if (audience.corporation || audience.bcCompany) {
    return [
      slot("constitutionDocId", "Articles", "the articles", "ArticlesOfIncorporation"),
      // A BC company's articles take the place of separate by-laws.
      ...(audience.bcCompany ? [] : [slot("bylawsDocId", "By-laws", "the by-laws", "Bylaws")]),
    ];
  }
  return [
    slot("constitutionDocId", "Constitution", "the constitution", "Constitution"),
    slot("bylawsDocId", "Bylaws", "the bylaws", "Bylaws"),
  ];
}

export function governingDocumentSlot(organization: LegalEntityLike | null | undefined, field: unknown) {
  return governingDocumentSlots(organization).find((slot) => slot.field === field);
}

/** Whether a document filed under `category` is filed as this field's document. */
export function categoryFitsGoverningField(category: unknown, field: GoverningDocumentField, organization?: LegalEntityLike | null) {
  return governanceSlotForCategory(category, governingDocumentAudience(organization)) === field;
}
