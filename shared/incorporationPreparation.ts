/** Compatibility accessors. Pathway registration and eligibility live in pathways/registry. */
import type { LegalEntityLike } from "./organizationDomain";
import { PATHWAY_REGISTRY, resolvePathway } from "./pathways/registry";
export type { IncorporationPreparationGuide } from "./pathways/data/preparation";
export const INCORPORATION_PREPARATION_GUIDES = PATHWAY_REGISTRY.flatMap((entry) => entry.preparation ? [entry.preparation] : []);
export function incorporationPreparationForOrganization(organization?: LegalEntityLike | null) {
  const result = resolvePathway(organization);
  return result.allowed ? result.pathway?.preparation : undefined;
}
