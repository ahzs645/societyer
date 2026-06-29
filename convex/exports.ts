import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { createDownloadUrl } from "./providers/storage";
import {
  listExportableTablesPortable,
  exportTablePortable,
  exportTablePagePortable,
  countTablePagePortable,
  exportWorkspacePortable,
  validateCurrentDatabasePortable,
} from "../shared/functions/exports";
import { toPortableQueryCtx } from "./lib/portable";

// Kept here as the canonical literal so source-scanning scripts
// (scripts/check-export-coverage.ts, scripts/validate-export-database.ts,
// scripts/export-workspace-with-files.ts) continue to find it. The ported
// handlers in shared/functions/exports.ts carry their own copy.
export const EXPORTABLE_TABLES = [
  "societies",
  "organizationAddresses",
  "organizationRegistrations",
  "organizationIdentifiers",
  "roleHolders",
  "roleHolderRevisions",
  "rightsClasses",
  "rightsholdingTransfers",
  "legalTemplateDataFields",
  "legalTemplates",
  "legalPrecedents",
  "legalPrecedentRuns",
  "generatedLegalDocuments",
  "legalSigners",
  "formationRecords",
  "nameSearchItems",
  "entityAmendments",
  "annualMaintenanceRecords",
  "jurisdictionMetadata",
  "supportLogs",
  "users",
  "apiClients",
  "apiTokens",
  "pluginInstallations",
  "webhookSubscriptions",
  "webhookDeliveries",
  "integrationSyncStates",
  "documentVersions",
  "paperlessConnections",
  "paperlessDocumentSyncs",
  "notifications",
  "notificationPrefs",
  "memberCommunicationPrefs",
  "communicationSegments",
  "communicationTemplates",
  "communicationCampaigns",
  "communicationDeliveries",
  "financialConnections",
  "waveCacheSnapshots",
  "waveCacheResources",
  "waveCacheStructures",
  "financialAccounts",
  "financialTransactions",
  "budgets",
  "operatingSubscriptions",
  "budgetSnapshots",
  "budgetSnapshotLines",
  "financialStatementImports",
  "financialStatementImportLines",
  "treasurerReports",
  "transactionCandidates",
  "accountingFiscalPeriods",
  "accountingCounterparties",
  "accountingAccountMappings",
  "fundRestrictions",
  "journalEntries",
  "journalLines",
  "reconciliationRuns",
  "reconciliationRunLines",
  "signatures",
  "filingBotRuns",
  "aiAgentRuns",
  "aiAgentAuditEvents",
  "aiSkills",
  "aiLogicFunctions",
  "aiChatThreads",
  "aiMessages",
  "aiToolDrafts",
  "aiProviderSettings",
  "aiModelCatalogCache",
  "recordLayouts",
  "workflows",
  "workflowPackages",
  "pendingEmails",
  "workflowRuns",
  "subscriptionPlans",
  "membershipFeePeriods",
  "memberSubscriptions",
  "fundingSources",
  "fundingSourceEvents",
  "transcripts",
  "transcriptionJobs",
  "customFieldDefinitions",
  "customFieldValues",
  "objectMetadata",
  "fieldMetadata",
  "views",
  "viewFields",
  "commandMenuItems",
  "members",
  "directors",
  "boardRoleAssignments",
  "boardRoleChanges",
  "signingAuthorities",
  "committees",
  "committeeMembers",
  "orgChartAssignments",
  "volunteers",
  "volunteerApplications",
  "volunteerScreenings",
  "meetings",
  "minutes",
  "meetingMaterials",
  "documentComments",
  "meetingAttendanceRecords",
  "motionEvidence",
  "filings",
  "grants",
  "grantApplications",
  "grantReports",
  "grantTransactions",
  "grantEmployeeLinks",
  "grantSources",
  "grantSourceProfiles",
  "grantOpportunityCandidates",
  "programStatements",
  "deadlines",
  "commitments",
  "commitmentEvents",
  "documents",
  "publications",
  "policies",
  "conflicts",
  "financials",
  "bylawRuleSets",
  "goals",
  "tasks",
  "assets",
  "assetEvents",
  "assetMaintenance",
  "assetVerificationRuns",
  "assetVerificationItems",
  "minuteBookItems",
  "activity",
  "notes",
  "invitations",
  "inspections",
  "directorAttestations",
  "complianceRemediations",
  "expenseReports",
  "writtenResolutions",
  "agmRuns",
  "noticeDeliveries",
  "insurancePolicies",
  "pipaTrainings",
  "proxies",
  "auditorAppointments",
  "memberProposals",
  "elections",
  "electionQuestions",
  "electionEligibleVoters",
  "electionBallots",
  "electionNominations",
  "electionAuditEvents",
  "donationReceipts",
  "employees",
  "courtOrders",
  "bylawAmendments",
  "agendas",
  "agendaItems",
  "meetingTemplates",
  "motionTemplates",
  "recordsLocation",
  "sourceEvidence",
  "secretVaultItems",
  "archiveAccessions",
  "assetReceiptLinks",
  "inventoryConnections",
  "inventoryItems",
  "inventoryLocations",
  "inventoryLots",
  "stockMovements",
  "inventoryBalances",
  "inventoryCounts",
  "inventoryCountLines",
  "inventoryCandidates",
  "rightsHoldings",
  "signatureProfiles",
  // YCN-derived registers (shared + corporation).
  "peopleDirectory",
  "serviceProviders",
  "societyNameHistory",
  "constatingEvents",
  "annualFilingLedger",
  "entitySigners",
  "dividends",
  "significantIndividualSteps",
  "shareCertificates",
  // Previously unregistered society-data tables (coverage gaps).
  "motions",
  "bylawSections",
  "orgChartAssignmentRevisions",
  "partyPortals",
] as const;

export const listExportableTables = query({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.any(),
  handler: (ctx, args) => listExportableTablesPortable(toPortableQueryCtx(ctx), args),
});

export const exportTable = query({
  args: {
    societyId: v.id("societies"),
    table: v.string(),
    includeRecoverySecrets: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: (ctx, args) => exportTablePortable(toPortableQueryCtx(ctx), args),
});

export const exportTablePage = query({
  args: {
    societyId: v.id("societies"),
    table: v.string(),
    paginationOpts: paginationOptsValidator,
    includeRecoverySecrets: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: (ctx, args) => exportTablePagePortable(toPortableQueryCtx(ctx), args),
});

export const countTablePage = query({
  args: {
    societyId: v.id("societies"),
    table: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: (ctx, args) => countTablePagePortable(toPortableQueryCtx(ctx), args),
});

export const exportAttachmentPage = query({
  args: {
    societyId: v.id("societies"),
    source: v.union(v.literal("documents"), v.literal("documentVersions")),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, { societyId, source, paginationOpts }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");

    if (source === "documentVersions") {
      const page = await ctx.db
        .query("documentVersions")
        .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
        .paginate(paginationOpts);
      const attachments = await Promise.all(
        page.page.map(async (row: any) => ({
          source: "documentVersions",
          id: row._id,
          documentId: row.documentId,
          version: row.version,
          storageProvider: row.storageProvider,
          storageKey: row.storageKey,
          fileName: row.fileName,
          mimeType: row.mimeType,
          fileSizeBytes: row.fileSizeBytes,
          sha256: row.sha256,
          downloadUrl: await downloadUrlForVersion(row),
        })),
      );
      return { ...page, page: attachments };
    }

    const page = await ctx.db
      .query("documents")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .paginate(paginationOpts);
    const attachments = await Promise.all(
      page.page
        .filter((row: any) => row.storageId || row.url)
        .map(async (row: any) => ({
          source: "documents",
          id: row._id,
          documentId: row._id,
          title: row.title,
          category: row.category,
          storageProvider: row.storageId ? "convex" : "externalUrl",
          storageId: row.storageId ? String(row.storageId) : undefined,
          fileName: row.fileName,
          mimeType: row.mimeType,
          fileSizeBytes: row.fileSizeBytes,
          externalUrl: row.url,
          downloadUrl: row.storageId ? await ctx.storage.getUrl(row.storageId) : row.url,
        })),
    );
    return { ...page, page: attachments };
  },
});

export const exportWorkspace = query({
  args: {
    societyId: v.id("societies"),
    includeEmptyTables: v.optional(v.boolean()),
    includeRecoverySecrets: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: (ctx, args) => exportWorkspacePortable(toPortableQueryCtx(ctx), args),
});

async function downloadUrlForVersion(row: any) {
  if (row.storageProvider === "local") {
    const base =
      (globalThis as any)?.process?.env?.SOCIETYER_API_PUBLIC_URL ??
      (globalThis as any)?.process?.env?.BETTER_AUTH_BASE_URL?.replace(/\/$/, "").replace(/:5173$/, ":8787") ??
      "http://127.0.0.1:8787";
    return `${base.replace(/\/$/, "")}/api/v1/workflow-generated-documents/${encodeURIComponent(row.storageKey)}`;
  }
  if (row.storageProvider === "rustfs" || row.storageProvider === "demo") {
    return await createDownloadUrl({
      provider: row.storageProvider,
      key: row.storageKey,
    });
  }
  return null;
}

export const validateCurrentDatabase = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => validateCurrentDatabasePortable(toPortableQueryCtx(ctx), args),
});
