import { v } from "convex/values";
export const clauseOriginArgs = {
  societyId: v.id("societies"),
  origin: v.union(v.literal("procurement"), v.literal("agreement")),
  originKey: v.string(),
};
export const clauseFields = v.object({
  quote: v.string(),
  kind: v.union(
    v.literal("limit"),
    v.literal("additionalInsured"),
    v.literal("certificate"),
    v.literal("wording"),
  ),
  coverageCode: v.string(),
  limitBasis: v.string(),
  minimumCents: v.optional(v.number()),
  currency: v.string(),
  namedInsured: v.string(),
  beneficiary: v.string(),
  from: v.string(),
  through: v.string(),
  stage: v.string(),
  dueDate: v.string(),
});
export const clauseSource = v.object({
  label: v.string(),
  reference: v.string(),
  version: v.string(),
  inputKey: v.optional(v.string()),
  publication: v.optional(v.string()),
});
export const evidenceSelection = {
  policyId: v.id("insurancePolicies"),
  lineId: v.string(),
  documentId: v.id("documents"),
  versionId: v.id("documentVersions"),
  citation: v.string(),
  wording: v.string(),
};
