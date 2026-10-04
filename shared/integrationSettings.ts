/** Non-secret storage policy and administrator evidence, portable across runtimes. */
export const STORAGE_PREFERENCES = ["existing", "local-filesystem", "rustfs", "r2", "sharepoint"] as const;
export type StoragePreference = typeof STORAGE_PREFERENCES[number];
export type EvidenceStatus = "unknown" | "recorded" | "revoked";
export type IntegrationSettings = {
  preferredProvider: StoragePreference;
  authorizationMode: "delegated" | "application";
  tenantId: string;
  siteId: string;
  libraryId: string;
  consentStatus: EvidenceStatus;
  resourceGrantStatus: EvidenceStatus;
  permissionEvidence: string;
  canadianResidencyRequired: boolean;
  storageRegion: string;
  residencyEvidence: string;
  custodian: "organization" | "operator";
  custodianContact: string;
  offboardingPlan: string;
};

export function defaultIntegrationSettings(): IntegrationSettings {
  return { preferredProvider: "existing", authorizationMode: "delegated", tenantId: "", siteId: "", libraryId: "",
    consentStatus: "unknown", resourceGrantStatus: "unknown", permissionEvidence: "",
    canadianResidencyRequired: false, storageRegion: "", residencyEvidence: "", custodian: "organization",
    custodianContact: "", offboardingPlan: "" };
}

const TEXT_FIELDS = ["tenantId", "siteId", "libraryId", "permissionEvidence", "storageRegion", "residencyEvidence", "custodianContact", "offboardingPlan"] as const;
/** Reject unknown fields so credentials cannot slip into this settings object. */
export function validateIntegrationSettings(value: unknown): IntegrationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid document storage settings.");
  const input = value as Record<string, unknown>;
  const keys = Object.keys(defaultIntegrationSettings());
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error("Document storage settings contain unsupported fields. Store credentials in server secret storage.");
  if (!STORAGE_PREFERENCES.includes(input.preferredProvider as StoragePreference)) throw new Error("Choose a supported storage preference.");
  if (!["delegated", "application"].includes(String(input.authorizationMode))) throw new Error("Choose delegated or application authorization.");
  for (const key of ["consentStatus", "resourceGrantStatus"]) {
    if (!["unknown", "recorded", "revoked"].includes(String(input[key]))) throw new Error("Invalid permission evidence status.");
  }
  if (typeof input.canadianResidencyRequired !== "boolean") throw new Error("Residency preference must be a boolean.");
  if (!["organization", "operator"].includes(String(input.custodian))) throw new Error("Choose who has custody of the records.");
  const result = { ...input } as IntegrationSettings;
  for (const key of TEXT_FIELDS) {
    if (typeof input[key] !== "string" || (input[key] as string).length > 4000) throw new Error(`Invalid ${key}; use no more than 4,000 characters.`);
    result[key] = (input[key] as string).trim();
    // These fields hold evidence references or prose, never bearer credentials.
    if (/\b(?:Bearer\s+[\w.-]{15,}|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+|(?:client_secret|access_token|refresh_token|password|secret_access_key)\s*[:=])/i.test(result[key])) {
      throw new Error("Remove credentials from document storage settings. Store secrets in server secret storage.");
    }
  }
  if (result.preferredProvider === "sharepoint" && (result.consentStatus === "recorded" || result.resourceGrantStatus === "recorded")) {
    if (!result.tenantId || !result.permissionEvidence) throw new Error("Record the tenant and permission evidence reference before recording consent or a resource grant.");
    if (result.resourceGrantStatus === "recorded" && (!result.siteId || !result.libraryId)) throw new Error("Record the selected site and library for the resource grant.");
  }
  return result;
}

/** Evidence is never a token probe or proof of a working deployment. */
export function sharePointReadiness(settings: IntegrationSettings): string[] {
  return [
    ...(!settings.tenantId ? ["Tenant is not recorded"] : []),
    ...(!settings.siteId ? ["Selected site is not recorded"] : []),
    ...(!settings.libraryId ? ["Document library is not recorded"] : []),
    ...(settings.consentStatus !== "recorded" ? ["Permission consent evidence is not recorded"] : []),
    ...(settings.authorizationMode === "application" && settings.resourceGrantStatus !== "recorded" ? ["Selected-resource grant evidence is not recorded"] : []),
    "Graph access token has not been checked", "SharePoint deployment integration is not configured",
  ];
}
