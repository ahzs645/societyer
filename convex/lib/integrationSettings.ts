import { v } from "convex/values";
const evidenceStatus = v.union(v.literal("unknown"), v.literal("recorded"), v.literal("revoked"));
export const integrationSettingsValidator = v.object({
  preferredProvider: v.union(v.literal("existing"), v.literal("local-filesystem"), v.literal("rustfs"), v.literal("r2"), v.literal("sharepoint")),
  authorizationMode: v.union(v.literal("delegated"), v.literal("application")),
  tenantId: v.string(), siteId: v.string(), libraryId: v.string(),
  consentStatus: evidenceStatus, resourceGrantStatus: evidenceStatus, permissionEvidence: v.string(),
  canadianResidencyRequired: v.boolean(), storageRegion: v.string(), residencyEvidence: v.string(),
  custodian: v.union(v.literal("organization"), v.literal("operator")),
  custodianContact: v.string(), offboardingPlan: v.string(),
});
