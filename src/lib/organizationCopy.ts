/**
 * Compatibility re-export. Entity-aware wording lives in
 * `organizationVocabulary.ts`; new code imports `organizationVocabulary` from
 * there. This keeps `organizationCopy(org)` working for existing imports.
 */
export { organizationCopy, type OrganizationCopy } from "./organizationVocabulary";
