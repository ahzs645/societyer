// Import-session domain constants: document tags, categories, and record-kind enums.

const SESSION_TAG = "import-session";

const RECORD_TAG = "import-session-record";

const SESSION_CATEGORY = "Import Session";

const RECORD_CATEGORY = "Import Candidate";

const HISTORY_TAG = "org-history";

const HISTORY_SOURCE_TAG = "org-history-source";

const HISTORY_ITEM_TAG = "org-history-item";

const HISTORY_SOURCE_CATEGORY = "Org History Source";

const HISTORY_ITEM_CATEGORY = "Org History Item";

const REVIEW_STATUSES = ["Pending", "Approved", "Rejected"] as const;

const HISTORY_KINDS = ["fact", "event", "boardTerm", "motion", "budget"] as const;

const SECTION_RECORD_KINDS = [
  "filing",
  "deadline",
  "bylawAmendment",
  "publication",
  "insurancePolicy",
  "financialStatement",
  "financialStatementImport",
  "grant",
  "recordsLocation",
  "archiveAccession",
  "boardRoleAssignment",
  "boardRoleChange",
  "signingAuthority",
  "meetingAttendance",
  "motionEvidence",
  "budgetSnapshot",
  "treasurerReport",
  "transactionCandidate",
  "organizationAddress",
  "organizationRegistration",
  "organizationIdentifier",
  "policy",
  "workflowPackage",
  "minuteBookItem",
  "roleHolder",
  "rightsClass",
  "rightsholdingTransfer",
  "legalTemplateDataField",
  "legalTemplate",
  "legalPrecedent",
  "legalPrecedentRun",
  "generatedLegalDocument",
  "legalSigner",
  "formationRecord",
  "nameSearchItem",
  "entityAmendment",
  "annualMaintenanceRecord",
  "jurisdictionMetadata",
  "supportLog",
  "sourceEvidence",
  "secretVaultItem",
  "pipaTraining",
  "employee",
  "volunteer",
] as const;

export {
  SESSION_TAG,
  RECORD_TAG,
  SESSION_CATEGORY,
  RECORD_CATEGORY,
  HISTORY_TAG,
  HISTORY_SOURCE_TAG,
  HISTORY_ITEM_TAG,
  HISTORY_SOURCE_CATEGORY,
  HISTORY_ITEM_CATEGORY,
  REVIEW_STATUSES,
  HISTORY_KINDS,
  SECTION_RECORD_KINDS,
};
