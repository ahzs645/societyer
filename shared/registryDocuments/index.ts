/**
 * Corporations Canada and BC Registries documents → reviewable import proposal.
 *
 * 1. `parseRegistryDocument(extract.text, fileName)` for each file (text from
 *    `extractBytes`; classification is by content, never by file name).
 * 2. `buildRegistryImportProposal(parsed, currentSnapshot)` for the review.
 * 3. `proposalToApplyArgs(proposal, selection)` → `{ args, documentRefs }`;
 *    upload the files, then `withRegistryDocumentIds(plan, idsByFingerprint)`
 *    gives the args for `organizationDetails.applyRegistryImport`.
 */
export { classifyRegistryDocument } from "./classify";
export { parseRegistryDocument, SECRET_MASK } from "./parse";
export { buildRegistryImportProposal, defaultRegistryImportSelection, proposalToApplyArgs, withRegistryDocumentIds } from "./proposal";
export { normalizeRegistryText } from "./text";
export type * from "./types";
