import { v } from "convex/values";

const answer = v.union(v.literal("yes"), v.literal("no"), v.literal("unknown"));
/** Optional for existing workspaces. Missing facts remain unassessed; do not
 * backfill privacy law from incorporation jurisdiction. */
export const privacyAssessmentValidators = {
  privacyOperatingJurisdictions: v.optional(v.array(v.string())),
  privacyCommercialActivity: v.optional(answer),
  privacyFederalWork: v.optional(answer),
  privacyCrossBorderCommercial: v.optional(answer),
  privacyQuebecEnterprise: v.optional(answer),
  privacyAlbertaNonprofitClass: v.optional(v.union(v.literal("section-56"), v.literal("other"), v.literal("unknown"))),
  privacySectorSpecific: v.optional(v.union(v.literal("none"), v.literal("health"), v.literal("public"), v.literal("unknown"))),
  privacyScopeReviewedAtISO: v.optional(v.string()),
};
