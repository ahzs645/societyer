import { organizationRuleScope } from "./entityRuleScope";
import type { LegalEntityLike, OrganizationKind } from "./organizationDomain";

/**
 * Entity-aware wording for server-generated annual-meeting text (year-end
 * readiness, the annual cycle, derived deadlines, meeting notice coverage).
 *
 * Societies hold an AGM of members. Business corporations hold an annual
 * meeting of shareholders. A custom entity gets neutral wording because the
 * repo does not know who its voters are. This only chooses labels; it never
 * supplies a statute or section number.
 *
 * Mirrors the labels in src/lib/organizationCopy.ts (which shared code cannot
 * import) so server text and page text agree.
 */
export type EntityMeetingWording = {
  kind: OrganizationKind;
  isSociety: boolean;
  isCorporation: boolean;
  /** Short label in running text: "AGM" for a society, "annual meeting" otherwise. */
  annualMeeting: string;
  /** Sentence-start label: "AGM" / "Annual meeting". */
  annualMeetingTitle: string;
  /** Long form: "annual general meeting" / "annual meeting of shareholders" / "annual meeting". */
  annualMeetingLong: string;
  /** Who gets notice and votes: "member" / "shareholder"; null when the entity type does not say. */
  holder: string | null;
  holders: string | null;
  /** Governing documents in neutral wording: "bylaws" / "articles or by-laws" / "governing documents". */
  governingDocuments: string;
};

export function entityMeetingWording(organization?: LegalEntityLike | null): EntityMeetingWording {
  const scope = organizationRuleScope(organization);
  if (scope.isSociety) {
    return {
      kind: "society",
      isSociety: true,
      isCorporation: false,
      annualMeeting: "AGM",
      annualMeetingTitle: "AGM",
      annualMeetingLong: "annual general meeting",
      holder: "member",
      holders: "members",
      governingDocuments: "bylaws",
    };
  }
  if (scope.isCorporation) {
    return {
      kind: "corporation",
      isSociety: false,
      isCorporation: true,
      annualMeeting: "annual meeting",
      annualMeetingTitle: "Annual meeting",
      annualMeetingLong: "annual meeting of shareholders",
      holder: "shareholder",
      holders: "shareholders",
      governingDocuments: "articles or by-laws",
    };
  }
  return {
    kind: scope.kind,
    isSociety: false,
    isCorporation: false,
    annualMeeting: "annual meeting",
    annualMeetingTitle: "Annual meeting",
    annualMeetingLong: "annual meeting",
    holder: null,
    holders: null,
    governingDocuments: "governing documents",
  };
}
