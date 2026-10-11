import type { LegalEntityLike } from "../../shared/organizationDomain";
import { organizationRuleScope } from "../../shared/entityRuleScope";

/**
 * Which workspaces a research-library record is written for.
 *
 * Every record in `src/lib/research/*.json` carries a `research_area`. Three
 * areas are entity- and jurisdiction-specific; the rest (root findings,
 * storage, authentication, repo permissions) are platform research that
 * applies to every workspace. Records are only filtered or labelled, never
 * removed.
 */
export const ENTITY_RESEARCH_AREAS = {
  bc_society: "BC societies",
  bc_company: "BC companies",
  federal_ontario: "Federal (CBCA) and Ontario corporations",
} as const;

export type EntityResearchArea = keyof typeof ENTITY_RESEARCH_AREAS;

function isEntityArea(area: string): area is EntityResearchArea {
  return Object.prototype.hasOwnProperty.call(ENTITY_RESEARCH_AREAS, area);
}

/**
 * The entity-specific research areas that apply to this workspace, or `null`
 * while the workspace is loading (then every record is shown). An entity or
 * jurisdiction with no research area of its own gets `[]`: only platform
 * research by default, with "All entity types" one switch away.
 */
export function researchAreasForOrganization(organization?: LegalEntityLike | null): EntityResearchArea[] | null {
  if (!organization) return null;
  const scope = organizationRuleScope(organization);
  if (scope.isBcSociety) return ["bc_society"];
  if (scope.isCorporation && scope.jurisdictionCode === "CA-BC") return ["bc_company"];
  if (scope.isCorporation && (scope.jurisdictionCode === "CA-FED-CBCA" || scope.jurisdictionCode.startsWith("CA-ON"))) return ["federal_ontario"];
  return [];
}

/** Who the record is for: an entity audience, or `null` for platform research that applies everywhere. */
export function researchAudienceLabel(area: unknown): string | null {
  const value = String(area ?? "");
  return isEntityArea(value) ? ENTITY_RESEARCH_AREAS[value] : null;
}

/** True when a record with this research area applies to the workspace. */
export function researchAreaApplies(area: unknown, applicableAreas: EntityResearchArea[] | null): boolean {
  const value = String(area ?? "");
  if (!isEntityArea(value)) return true;
  return applicableAreas === null || applicableAreas.includes(value);
}
