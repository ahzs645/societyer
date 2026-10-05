/** Destination rights used by import controls and backend preflight. */
export function importSectionPermission(kind: string): string {
  const resources: Record<string, string[]> = {
    financials: ["insurancePolicy", "financialStatement", "financialStatementImport", "budgetSnapshot", "treasurerReport", "transactionCandidate", "asset", "dividend"],
    filings: ["filing"], deadlines: ["deadline", "significantIndividualStep"], grants: ["grant"],
    society: ["organizationAddress", "organizationRegistration", "organizationIdentifier"],
    tasks: ["workflowPackage"], minutes: ["minuteBookItem"], employees: ["employee"], volunteers: ["volunteer"],
    attestations: ["pipaTraining"],
    settings: ["serviceProvider", "nameHistory", "secretVaultItem", "publication"],
    documents: ["bylawAmendment", "recordsLocation", "archiveAccession", "boardRoleAssignment", "boardRoleChange", "signingAuthority", "meetingAttendance", "motionEvidence", "policy", "roleHolder", "rightsClass", "rightsholdingTransfer", "constatingEvent", "shareCertificate", "legalTemplateDataField", "legalTemplate", "legalPrecedent", "legalPrecedentRun", "generatedLegalDocument", "legalSigner", "formationRecord", "nameSearchItem", "entityAmendment", "annualMaintenanceRecord", "jurisdictionMetadata", "supportLog", "sourceEvidence"],
  };
  return `${Object.entries(resources).find(([, kinds]) => kinds.includes(kind))?.[0] ?? "settings"}:write`;
}
