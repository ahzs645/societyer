import { organizationKind, type LegalEntityLike, type OrganizationKind } from "../../shared/organizationDomain";

/**
 * Entity-aware wording for governance and people surfaces.
 *
 * Societies (BC Societies Act) govern through members, AGMs and special
 * resolutions; business corporations govern through shareholders and
 * shareholder meetings. Pages use this so a corporation workspace never sees
 * society wording or Societies Act citations.
 *
 * `societyLaw` decides whether society-only legal references (Societies Act
 * sections, Societies Online, BC-SOC citations) may be shown. It is true for
 * societies and for legacy workspaces that predate entity classification (no
 * entity type and no governing Act recorded) — Societyer began as a BC
 * Societies Act tool and those records are societies. A workspace with an
 * explicit non-society classification (a corporation, co-operative, custom
 * entity) never gets society-only references.
 */
export type GovernanceVocabulary = {
  kind: OrganizationKind;
  isCorporation: boolean;
  /** Society-only legal references and guidance may be shown. */
  societyLaw: boolean;
  /** "society" | "corporation" | "organization" */
  organizationNoun: string;
  /** Person who votes at a general meeting: "member" or "shareholder". */
  voterNoun: string;
  voterNounPlural: string;
  /** "general meeting" for societies/organizations, "shareholder meeting" for corporations. */
  generalMeetingNoun: string;
};

export function governanceVocabulary(organization?: LegalEntityLike | null): GovernanceVocabulary {
  const kind = organizationKind(organization);
  const isCorporation = kind === "corporation";
  const unclassified =
    kind === "organization" &&
    !String(organization?.entityType ?? "").trim() &&
    !String(organization?.actFormedUnder ?? "").trim();
  const societyLaw = kind === "society" || unclassified;
  return {
    kind,
    isCorporation,
    societyLaw,
    organizationNoun: societyLaw ? "society" : isCorporation ? "corporation" : "organization",
    voterNoun: isCorporation ? "shareholder" : "member",
    voterNounPlural: isCorporation ? "shareholders" : "members",
    generalMeetingNoun: isCorporation ? "shareholder meeting" : "general meeting",
  };
}

export function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
