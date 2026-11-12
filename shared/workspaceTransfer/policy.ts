/**
 * Reviewed per-table policy for moving one workspace between deployments.
 *
 * Every table in `convex/schema.ts` must appear here exactly once
 * (`scripts/check-workspace-transfer-policy.ts` enforces it), so a new table
 * can't be copied or dropped without someone deciding which.
 *
 * - `copy`: a workspace record. Copied with new ids and every reference rewritten.
 * - `copy-disabled`: copied, with whatever would act on its own (schedules,
 *   senders, worker keys) switched off until someone re-enables it on the destination.
 * - `skip`: credentials, sessions, deployment configuration, caches and queues.
 *   Rows are reported, never copied; references to them are dropped (optional)
 *   or block the plan (required).
 *
 * `strip` removes fields, `set` overwrites them, and `blockIf` names a row state
 * that must be finished at the source before the final export.
 */
import { IMPORTED_AUTH_BINDING_FIELDS } from "../workspaceIdentity";

export type TransferRow = Record<string, unknown>;
export type TablePolicy = {
  mode: "copy" | "copy-disabled" | "skip";
  reason: string;
  strip?: readonly string[];
  set?: Readonly<Record<string, string | number | boolean>>;
  blockIf?: (row: TransferRow) => string | null;
};

/** Set on a transferred `societies` row until `finalize`. */
export const QUARANTINE_FIELD = "transferQuarantinedAtISO";

const RECORDS = "Workspace record.";

/** Plain `copy` tables; listed once, never also given an explicit entry below. */
export const TRANSFER_COPY_TABLES = [
  "accountingAccountMappings", "accountingCounterparties", "accountingFiscalPeriods", "activity", "agendaItems", "agendas", "agmRuns", "agreements",
  "aiAgentAuditEvents", "aiAgentRuns", "aiChatThreads", "aiLogicFunctions", "aiMessages", "aiSkills", "aiToolDrafts", "annualFilingLedger",
  "annualMaintenanceRecords", "approvalPolicyChanges", "archiveAccessions", "assetEvents", "assetMaintenance", "assetReceiptLinks", "assetVerificationItems", "assetVerificationRuns",
  "assets", "auditorAppointments", "bankAccountProfiles", "billingCustomerPricing", "billingInvoiceViews", "billingPriceProfiles", "billingQuoteRevisions", "billingQuotes",
  "bills", "boardRoleAssignments", "boardRoleChanges", "booksSettings", "budgetSnapshotLines", "budgetSnapshots", "budgets", "bylawAmendments",
  "bylawRuleSets", "bylawSections", "cardStatements", "commandMenuItems", "commitmentEvents", "commitments", "committeeMembers", "committees",
  "communicationCampaigns", "communicationDeliveries", "communicationSegments", "communicationTemplates", "complianceRemediations", "conflicts", "constatingEvents", "continuityPeriodMarks",
  "corporateCards", "costPlanningItems", "costPlanningPeriods", "courtOrders", "customFieldDefinitions", "customFieldValues", "customerStatementSnapshots", "deadlines",
  "directorAttestations", "directors", "dividends", "documentComments", "documentVersions", "documents", "donationReceiptSequences",
  "donationReceipts", "electionAuditEvents", "electionBallots", "electionEligibleVoters", "electionNominations", "electionQuestions", "elections", "employees",
  "entityAmendments", "entitySigners", "expenseApprovalRules", "expenseApprovalSettings", "expenseClaimPolicy", "expenseReports", "fieldMetadata",
  "fieldProvenance", "filingBotRuns", "filings", "financeTagGroups", "financeTags", "financialAccounts", "financialConnections", "financialStatementImportLines",
  "financialStatementImports", "financialTransactions", "financialVersionSelections", "financials", "formationRecords", "fundRestrictions", "fundingSourceEvents", "fundingSources",
  "generatedLegalDocuments", "goals", "governanceExpectations", "grantApplications", "grantEmployeeLinks", "grantOpportunityCandidates", "grantReports", "grantSourceProfiles",
  "grantSources", "grantTransactions", "grants", "importTargets", "inspections", "insurancePolicies", "intakeClusters", "intakeExtractions",
  "intakeExtracts", "intakeFieldReviews", "intakeFiles", "intakeProcessingLog", "intakeRuns", "inventoryBalances", "inventoryCandidates", "inventoryConnections",
  "inventoryCountLines", "inventoryCounts", "inventoryItems", "inventoryLocations", "inventoryLots", "investmentHoldings", "invoiceCatalogItems", "invoicePriceLists",
  "invoiceDocumentRevisions", "invoiceSeries", "invoiceSettings", "invoiceTemplates", "invoices", "journalEntries", "journalLines", "legalPrecedentRuns", "legalPrecedents",
  "legalSigners", "legalTemplateDataFields", "legalTemplates", "listViews", "meetingAttendanceRecords", "meetingMaterials", "meetingTemplates", "meetingTranscriptPages",
  "meetingTranscriptionJobs", "meetings", "memberAssessments", "memberCommunicationPrefs", "memberHistoryEvents", "memberProposals", "memberSubscriptions", "members",
  "membershipFeePeriods", "membershipRuleVersions", "minuteBookItems", "minutes", "motionEvidence", "motionTemplates", "motions", "nameSearchItems",
  "notes", "noticeDeliveries", "notificationReceipts", "notificationRules", "notifications", "objectMetadata",
  "operatingSubscriptions", "orgChartAssignmentRevisions", "orgChartAssignments", "organizationAddresses", "organizationIdentifiers", "organizationRegistrations", "organizationSeats", "organizationTaxRegistrations",
  "paperlessConnections", "paperlessDocumentSyncs", "pathwayAudit", "pathwayRuns", "pathwaySteps", "payRuns", "payeeAliases",
  "payrollCalculations", "payrollEarningCodes", "payrollEmployeeProfiles", "payrollEmployerProfiles", "payrollOpeningBalances", "payrollRemittancePlans", "payrollRemittanceReadiness", "payrollRemittanceSettlements",
  "payrollRemittances", "payrollRoeWorkflowCases", "payrollRuleEditions", "payrollSettings", "payrollSlips", "payrollTd1Declarations", "payrollVacationPeriods", "payrollVacationRequests",
  "payrollWorkDays", "pendingEmails", "peopleDirectory", "personContactPoints", "personHistoryEvents", "personMerges", "personOccurrences", "pipaTrainings",
  "policies", "procurementAnalytics", "procurementAnalyticsArtifacts", "procurementAnalyticsBundles", "procurementCatalogs", "procurementDetails", "procurementDocuments", "procurementEvidence",
  "procurementRecords", "procurementSearch", "procurementSourcePublications", "procurementTaxonomyReleases", "procurementTaxonomyTerms", "procurementTriage",
  "programStatements", "proxies", "publications", "receiptInboxItems", "reconciliationPeriods", "reconciliationRunLines", "reconciliationRuns", "recordLayouts",
  "recordsLocation", "recordsOfEmployment", "repairJobs", "repairOperationEvents", "repairOperations", "repairTimeEntries", "reportDefinitions", "reportFilterPresets",
  "representationGaps", "rightsClasses", "rightsHoldings", "rightsholdingTransfers", "roleHolderRevisions", "roleHolders", "seatProxyAuthorizations", "serviceProviders",
  "shareCertificates", "signatureProfiles", "signatures", "significantIndividualSteps", "signingAuthorities", "societyNameHistory", "sourceEvidence", "spendBudgets",
  "staffCostPlans", "stockMovements", "subscriptionPlans", "taskAttachments", "tasks", "transactionCandidates", "transactionRules", "transcriptionJobs",
  "transcripts", "treasurerReports", "viewFields", "views", "volunteerApplications", "volunteerScreenings", "volunteers", "workflowPackages",
  "workflowRuns", "writtenResolutions",
] as const;

const skip = (reason: string): TablePolicy => ({ mode: "skip", reason });
const IDENTITY = "Sign-in identity or person link on the source deployment; the destination proves its own logins.";
const CREDENTIAL = "Credential or bearer token; reissue on the destination.";
const OPERATOR = "Per-deployment operator configuration; set it on the destination with its own commands.";
const OFFLINE = "Per-deployment offline projection or replay state; rebuilt on the destination.";
const CACHE = "Cache of a provider or catalogue; refetched on demand.";

const inFlight = (states: readonly string[], field = "status") => (row: TransferRow) =>
  states.includes(String(row[field])) ? `${field} is "${String(row[field])}"; finish or cancel it at the source before the final export` : null;

export const TRANSFER_POLICY: Readonly<Record<string, TablePolicy>> = {
  ...Object.fromEntries(TRANSFER_COPY_TABLES.map((table) => [table, { mode: "copy", reason: RECORDS } satisfies TablePolicy])),
  procurementServicePublications: skip(OPERATOR),
  procurementServiceRollouts: skip(OPERATOR),

  // Copied with changes.
  societies: {
    mode: "copy",
    reason: "The workspace itself. Created quarantined; the public slug is held back until finalize; the calendar feed token is a bearer secret.",
    strip: ["calendarFeedToken", QUARANTINE_FIELD],
  },
  users: {
    mode: "copy",
    reason: "Memberships keep role, status and profile so authorship stays attached; login bindings are never imported (bind explicitly).",
    strip: IMPORTED_AUTH_BINDING_FIELDS,
  },
  secretVaultItems: {
    mode: "copy",
    reason: "Vault metadata is a record, but ciphertext is sealed with the source deployment's SECRET_VAULT_ENCRYPTION_KEY; re-enter secrets.",
    strip: ["secretEncrypted", "secretPreview"],
    set: { status: "NeedsReview" },
  },
  aiProviderSettings: {
    mode: "copy",
    reason: "Provider choice is a record; its API key lived in the (redacted) vault, so it needs validating again.",
    set: { status: "needs_validation" },
  },
  meetingSources: {
    mode: "copy",
    reason: "Meeting recordings stay in the SharePoint location they were uploaded to; upload-session URLs and worker leases are bearer state.",
    strip: ["uploadUrl", "expiresAt", "lease", "leaseUntil"],
  },
  meetingSourceText: { mode: "copy", reason: "Transcript text of a meeting source (child rows without societyId)." },
  notificationPrefs: { mode: "copy", reason: "Per-membership notification switches (child rows without societyId)." },
  offlineMeetingAggregates: {
    mode: "copy",
    reason: "Marks meetings prepared for offline use; its id mappings are rewritten like any string-held id.",
  },
  billingAutomationRuns: {
    mode: "copy",
    reason: "Billing automation history; leases are bearer state and an in-flight run would be resumed by the destination's scan.",
    strip: ["leaseToken", "leaseUntilISO"],
    blockIf: (row) => inFlight(["queued", "retry", "blocked", "working"])(row)
      ?? (row.status === "accepted" && row.finalizedAtISO === undefined ? "an accepted run is not finalized; finish it at the source" : null),
  },
  pathwaySubmissionOutbox: {
    mode: "copy",
    reason: "Filing submission history; a queued or dispatching submission could be sent twice.",
    blockIf: inFlight(["queued", "dispatching"]),
  },
  procurementImportJobs: {
    mode: "copy",
    reason: "Procurement publication history; an unfinished import job belongs to the source.",
    blockIf: (row) => ["ready", "failed"].includes(String(row.phase)) ? null : `phase is "${String(row.phase)}"; finish the import at the source`,
  },
  procurementSyncRuns: {
    mode: "copy",
    reason: "Procurement sync history; an unfinished run belongs to the source.",
    blockIf: (row) => row.completed === true || typeof row.error === "string" ? null : "sync run is not complete; finish it at the source",
  },
  procurementSyncBatches: { mode: "copy", reason: "Batches of a copied procurement sync run (child rows without societyId)." },
  documentSources: { mode: "copy", reason: "SharePoint source configuration of the workspace; external references depend on it." },
  externalDocumentReferences: { mode: "copy", reason: "SharePoint locators; they keep working while the destination uses the same SharePoint connection." },
  workspaceMfaPolicies: { mode: "copy", reason: "A workspace MFA requirement must not silently disappear." },
  workspaceAccessRequestSettings: { mode: "copy", reason: "The organization's own choice; requests only open once the operator maps a domain for the workspace." },

  // Copied with schedules, senders and worker keys switched off.
  workflows: {
    mode: "copy-disabled",
    reason: "A copied record is not authority to resume unattended work (as in archive restore); re-authorize schedules.",
    strip: ["scheduleAuthorization", "nextRunAtISO"],
    set: { scheduleEnabled: false },
  },
  billingAutomationSchedules: {
    mode: "copy-disabled",
    reason: "Recurring invoices and reminders send mail; re-activate after cutover.",
    set: { active: false },
  },
  billingAutomationSettings: {
    mode: "copy-disabled",
    reason: "The sender must be confirmed against the destination's mail setup; the due-scan cursor is per deployment.",
    strip: ["dueScanCursor", "dueScanAtISO"],
    set: { enabled: false, senderConfirmed: false },
  },
  meetingTranscriptionConnections: {
    mode: "copy-disabled",
    reason: "Transcription workers authenticate with this key hash; issue a new worker key on the destination.",
    strip: ["activeJobId", "heartbeatAt"],
    set: { enabled: false, keyHash: "revoked-by-workspace-transfer" },
  },

  // Never copied.
  microsoftMeetingCandidates: skip("Expiring Microsoft discovery cache; discover again on the destination."),
  microsoftMeetingPeople: skip("Reviewed login bindings are deployment-specific; review again on the destination."),
  microsoftMeetingImports: { mode: "copy", reason: "Historical meeting import provenance, not authority to fetch Microsoft data." },
  accountLinkEvents: skip(IDENTITY),
  accountLinkRequests: skip(IDENTITY),
  personAccounts: skip(IDENTITY),
  personIdentityLinks: skip(IDENTITY),
  externalIdentities: skip(IDENTITY),
  clerkMfaSessions: skip(IDENTITY),
  authRateLimits: skip("Sign-in throttling buckets of the source deployment."),
  authEmailOutbox: skip("Auth mail queue of the source deployment."),
  developmentAuthEmails: skip("Development auth mail capture."),
  apiClients: skip(CREDENTIAL),
  apiTokens: skip(CREDENTIAL),
  agentGrants: skip(CREDENTIAL),
  agentConnectorSettings: skip("Allowing AI connectors is a fresh decision on the destination (grants don't move)."),
  mcpOAuthClients: skip(CREDENTIAL),
  mcpOAuthEvents: skip(CREDENTIAL),
  mcpOAuthFamilies: skip(CREDENTIAL),
  mcpOAuthRequests: skip(CREDENTIAL),
  mcpOAuthTokens: skip(CREDENTIAL),
  partyPortals: skip(CREDENTIAL),
  invitations: skip("Pending invitation tokens; invite again (targeted invitations bind imported memberships)."),
  workspaceAccessRequests: skip("Requests name the source deployment's login identities, which don't exist in the destination; people ask again."),
  webhookSubscriptions: skip("Holds an encrypted signing secret; recreate the subscription."),
  webhookDeliveries: skip("Delivery queue of a skipped subscription."),
  pluginInstallations: skip("Bound to API clients that don't move; reinstall."),
  integrationSyncStates: skip("Provider sync cursors and webhook channels of the source deployment."),
  workspaceDomains: skip(OPERATOR),
  workspaceSignInPolicies: skip(OPERATOR),
  workspaceStoragePolicies: skip(OPERATOR),
  storageOwnership: skip("Regenerated: each copied file is claimed for the destination workspace."),
  documentUploadHandles: skip("Transient upload staging."),
  offlineMeetingDownloads: skip(OFFLINE),
  offlineMeetingScopes: skip(OFFLINE),
  offlineMeetingReceipts: skip(OFFLINE),
  powersync_checkpoints: skip(OFFLINE),
  aiModelCatalogCache: skip(CACHE),
  waveCacheResources: skip(CACHE),
  waveCacheSnapshots: skip(CACHE),
  waveCacheStructures: skip(CACHE),
  jurisdictionMetadata: skip("Global reference data seeded per deployment."),
  supportLogs: skip("Deployment diagnostics, not a workspace record."),
  procurementMaintenanceLeases: skip("Maintenance lease of the source deployment."),
  workspaceTransferRuns: skip("Transfer bookkeeping of the source deployment."),
  workspaceTransferIdMap: skip("Transfer bookkeeping of the source deployment."),
};

export function transferPolicy(table: string): TablePolicy | null {
  return Object.prototype.hasOwnProperty.call(TRANSFER_POLICY, table) ? TRANSFER_POLICY[table] : null;
}

export function isCopied(table: string): boolean {
  const policy = transferPolicy(table);
  return policy !== null && policy.mode !== "skip";
}

/**
 * The row as written to the destination, before references are resolved:
 * system fields removed, then the table's `strip` and `set`. Applied by the
 * CLI and again by the destination, so it never depends on the caller.
 */
export function applyPolicy(table: string, row: TransferRow): TransferRow {
  const policy = transferPolicy(table);
  if (!policy || policy.mode === "skip") throw new Error(`Table ${table} is not copied by a workspace transfer.`);
  const out: TransferRow = {};
  for (const [key, value] of Object.entries(row)) if (key !== "_id" && key !== "_creationTime" && value !== undefined) out[key] = value;
  for (const field of policy.strip ?? []) delete out[field];
  if (table === "societies" && out.integrationSettings && typeof out.integrationSettings === "object") out.integrationSettings = { ...(out.integrationSettings as Record<string, unknown>), procurementCatalogSource: "convex" };
  return { ...out, ...(policy.set ?? {}) };
}

/** Financial totals compared between the export and the destination (grouped by a plain value, never an id). */
export const TRANSFER_TOTALS: ReadonlyArray<{ table: string; groupBy?: string; sum: readonly string[] }> = [
  { table: "invoices", groupBy: "currency", sum: ["totalCents", "paidCents"] },
  { table: "bills", groupBy: "currency", sum: ["totalCents", "paidCents"] },
  { table: "journalLines", groupBy: "side", sum: ["amountCents"] },
  { table: "financialTransactions", sum: ["amountCents"] },
];
