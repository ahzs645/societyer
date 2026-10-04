/** Compatibility accessors for the registered pathway flows. */
import { canonicalizeJurisdictionCode, type LegalEntityLike } from "./organizationDomain";
import { PATHWAY_REGISTRY, resolvePathway } from "./pathways/registry";
import type { PostIncorporationStep, PostIncorporationStepCategory } from "./pathways/data/steps";
export type { PostIncorporationStep, PostIncorporationStepCategory, PostIncorporationStepCadence, PostIncorporationStepAuthority, PostIncorporationStepApplicability, PostIncorporationStepObligationLink, PostIncorporationFlow } from "./pathways/data/steps";
export const POST_INCORPORATION_FLOWS = PATHWAY_REGISTRY.flatMap((entry) => entry.flow ? [entry.flow] : []);
export function findPostIncorporationFlow(jurisdictionCode?: string | null, entityType?: string) {
  const code = canonicalizeJurisdictionCode(jurisdictionCode);
  return PATHWAY_REGISTRY.find((entry) => entry.availability === "preparation" && entry.eligibility.jurisdictions.includes(code) && (!entityType || entry.eligibility.entityTypes.includes(entityType)))?.flow;
}
export function postIncorporationStepsForOrganization(organization?: LegalEntityLike | null): PostIncorporationStep[] {
  const result = resolvePathway(organization);
  return result.allowed ? (result.pathway?.flow?.steps ?? []).slice().sort((a, b) => a.order - b.order) : [];
}
export function postIncorporationStepsByCategory(organization?: LegalEntityLike | null): Record<PostIncorporationStepCategory, PostIncorporationStep[]> {
  const result: Record<PostIncorporationStepCategory, PostIncorporationStep[]> = { organize: [], registration: [], good_standing: [] };
  for (const step of postIncorporationStepsForOrganization(organization)) result[step.category].push(step);
  return result;
}
