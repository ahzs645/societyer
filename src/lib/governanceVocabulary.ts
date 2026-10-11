import { organizationRuleScope } from "../../shared/entityRuleScope";
import type { LegalEntityLike, OrganizationKind } from "../../shared/organizationDomain";

/**
 * Entity-aware wording for governance and people surfaces.
 *
 * Societies (BC Societies Act) govern through members, AGMs and special
 * resolutions; business corporations govern through shareholders and
 * shareholder meetings. Pages use this so a corporation workspace never sees
 * society wording or Societies Act references.
 *
 * Built on `organizationRuleScope` (shared/entityRuleScope.ts), the single
 * source of truth for which rule families apply: `societyLaw` is true only when
 * BC Societies Act rules apply (a BC society, including legacy workspaces with
 * no recorded entity type). While the workspace is loading every flag is false,
 * so society-only content stays hidden rather than flashing.
 */
export type GovernanceVocabulary = {
  kind: OrganizationKind;
  isSociety: boolean;
  isCorporation: boolean;
  /** BC Societies Act references (sections, Societies Online, BC-SOC citations) may be shown. */
  societyLaw: boolean;
  /** "society" | "corporation" | "organization" */
  organizationNoun: string;
  /** Person who votes at a general meeting: "member" or "shareholder". */
  voterNoun: string;
  voterNounPlural: string;
};

export function governanceVocabulary(organization?: LegalEntityLike | null): GovernanceVocabulary {
  const scope = organizationRuleScope(organization);
  return {
    kind: scope.kind,
    isSociety: scope.isSociety,
    isCorporation: scope.isCorporation,
    societyLaw: scope.isBcSociety,
    organizationNoun: scope.isSociety ? "society" : scope.isCorporation ? "corporation" : "organization",
    voterNoun: scope.isCorporation ? "shareholder" : "member",
    voterNounPlural: scope.isCorporation ? "shareholders" : "members",
  };
}

export function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
