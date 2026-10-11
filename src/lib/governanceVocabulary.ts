/**
 * Compatibility re-export. Entity-aware wording lives in
 * `organizationVocabulary.ts`; new code imports `organizationVocabulary` from
 * there. This keeps `governanceVocabulary(org)` working for existing imports.
 */
export { capitalize, governanceVocabulary, type GovernanceVocabulary } from "./organizationVocabulary";
