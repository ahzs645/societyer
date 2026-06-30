/**
 * PORTABLE FUNCTIONS: the workspace-export domain
 * (listExportableTables / exportTable / exportTablePage / countTablePage /
 *  exportWorkspace / validateCurrentDatabase).
 *
 * Reads society-scoped rows over `ctx.db` and assembles redacted export
 * payloads. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * `exportAttachmentPage` resolves storage download URLs: a `local`/`rustfs`/
 * `demo` provider key through the portable signer (or the local generated-docs
 * endpoint), a Convex `_storage` id through the injected `ctx.capabilities.storage`.
 */

import type { PortableQueryCtx } from "../portable/ctx";
import { createDownloadUrl } from "../storage/signedUrl";

const EXPORT_VERSION = 2;

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

const EXPORTABLE_SET = new Set<string>(EXPORTABLE_TABLES);
const DEFAULT_REDACTED_FIELDS = ["secretEncrypted", "tokenHash", "storageId"] as const;
const RECOVERY_REDACTED_FIELDS = ["storageId"] as const;
const GLOBAL_TABLES = new Set(["jurisdictionMetadata", "aiModelCatalogCache"]);
const OPTIONAL_SOCIETY_TABLES = new Set(["legalTemplateDataFields", "legalTemplates", "legalPrecedents"]);
const SOCIETY_INDEX_BY_TABLE: Record<string, string> = {
  budgets: "by_society_fy",
  stockMovements: "by_society_date",
};

export async function listExportableTablesPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId?: string },
) {
  if (!societyId) {
    return EXPORTABLE_TABLES.map((name) => ({ name, rowCount: null, exportable: true }));
  }
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  return EXPORTABLE_TABLES.map((name) => ({ name, rowCount: null, exportable: true }));
}

export async function exportTablePortable(
  ctx: PortableQueryCtx,
  { societyId, table, includeRecoverySecrets }: { societyId: string; table: string; includeRecoverySecrets?: boolean },
) {
  const result = await paginateForSociety(
    ctx,
    table,
    societyId,
    { cursor: null, numItems: 100 },
    { includeRecoverySecrets: includeRecoverySecrets === true },
  );
  if (!result.isDone) {
    throw new Error("Table is too large for a single export query. Use exportTablePage.");
  }
  return result.page;
}

export async function exportTablePagePortable(
  ctx: PortableQueryCtx,
  { societyId, table, paginationOpts, includeRecoverySecrets }: { societyId: string; table: string; paginationOpts: any; includeRecoverySecrets?: boolean },
) {
  return await paginateForSociety(ctx, table, societyId, paginationOpts, {
    includeRecoverySecrets: includeRecoverySecrets === true,
  });
}

export async function countTablePagePortable(
  ctx: PortableQueryCtx,
  { societyId, table, paginationOpts }: { societyId: string; table: string; paginationOpts: any },
) {
  const result = await paginateForSociety(ctx, table, societyId, paginationOpts);
  return {
    count: result.page.length,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function exportAttachmentPagePortable(
  ctx: PortableQueryCtx,
  { societyId, source, paginationOpts }: { societyId: string; source: "documents" | "documentVersions"; paginationOpts: any },
) {
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
        downloadUrl: row.storageId ? (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(row.storageId) })).url : row.url,
      })),
  );
  return { ...page, page: attachments };
}

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

export async function exportWorkspacePortable(
  ctx: PortableQueryCtx,
  { societyId, includeEmptyTables, includeRecoverySecrets }: { societyId: string; includeEmptyTables?: boolean; includeRecoverySecrets?: boolean },
) {
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");

  const generatedAtISO = new Date().toISOString();
  const summaries = EXPORTABLE_TABLES.map((name) => ({ name, rowCount: null, exportable: true }));

  return {
    kind: "societyer.workspaceExport",
    version: EXPORT_VERSION,
    generatedAtISO,
    society: sanitizeRow(society, { includeRecoverySecrets: includeRecoverySecrets === true }),
    manifest: {
      societyId,
      societyName: society.name,
      tableCount: EXPORTABLE_TABLES.length,
      exportedTableCount: includeEmptyTables ? EXPORTABLE_TABLES.length : 0,
      totalRows: null,
      redactedFields: redactedFieldsFor({ includeRecoverySecrets: includeRecoverySecrets === true }),
      recoverySecretsIncluded: includeRecoverySecrets === true,
      binaryFilesIncluded: false,
      tables: summaries,
    },
    validation: validationFromSummaries(summaries, { includeRecoverySecrets: includeRecoverySecrets === true }),
    tables: {},
  };
}

export async function validateCurrentDatabasePortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const society = await ctx.db.get(societyId);
  if (!society) {
    return {
      ok: false,
      generatedAtISO: new Date().toISOString(),
      issues: ["Society not found."],
      tables: [],
      totalRows: 0,
    };
  }
  const tables = EXPORTABLE_TABLES.map((name) => ({ name, rowCount: null, exportable: true }));
  return {
    societyId,
    societyName: society.name,
    generatedAtISO: new Date().toISOString(),
    ...validationFromSummaries(tables),
    tables,
  };
}

async function paginateForSociety(
  ctx: PortableQueryCtx,
  table: string,
  societyId: string,
  paginationOpts: any,
  options?: { includeRecoverySecrets?: boolean },
) {
  assertExportable(table);

  if (table === "societies") {
    const society = await ctx.db.get(societyId);
    const include = society && (!paginationOpts.cursor || paginationOpts.cursor === "0");
    return {
      page: include ? [sanitizeRow(society, options)] : [],
      isDone: true,
      continueCursor: "",
    };
  }

  if (GLOBAL_TABLES.has(table)) {
    const page = await ctx.db.query(table).paginate(paginationOpts);
    return { ...page, page: page.page.map((row: Record<string, any>) => sanitizeRow(row, options)) };
  }

  if (table === "notificationPrefs") {
    const users = await ctx.db
      .query("users")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const rows: any[] = [];
    for (const user of users) {
      rows.push(
        ...(await ctx.db
          .query("notificationPrefs")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect()),
      );
    }
    return paginateCollectedRows(rows, paginationOpts, options);
  }

  if (OPTIONAL_SOCIETY_TABLES.has(table)) {
    const [globalRows, societyRows] = await Promise.all([
      ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", undefined)).collect(),
      ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);
    return paginateCollectedRows([...globalRows, ...societyRows], paginationOpts, options);
  }

  const indexName = SOCIETY_INDEX_BY_TABLE[table] ?? "by_society";
  const query = ctx.db.query(table).withIndex(indexName, (q) => q.eq("societyId", societyId));
  const page = await query.paginate(paginationOpts);
  return { ...page, page: page.page.map((row: Record<string, any>) => sanitizeRow(row, options)) };
}

function paginateCollectedRows(
  rows: any[],
  paginationOpts: { cursor?: string | null; numItems: number },
  options?: { includeRecoverySecrets?: boolean },
) {
  const start = paginationOpts.cursor ? Number(paginationOpts.cursor) : 0;
  const safeStart = Number.isFinite(start) && start > 0 ? start : 0;
  const end = safeStart + paginationOpts.numItems;
  const page = rows.slice(safeStart, end).map((row: Record<string, any>) => sanitizeRow(row, options));
  const isDone = end >= rows.length;
  return {
    page,
    isDone,
    continueCursor: isDone ? "" : String(end),
  };
}

function assertExportable(table: string) {
  if (!EXPORTABLE_SET.has(table)) {
    throw new Error(`Table "${table}" is not exportable.`);
  }
}

function validationFromSummaries(
  tables: Array<{ name: string; rowCount: number | null }>,
  options?: { includeRecoverySecrets?: boolean },
) {
  const issues: string[] = [];
  const names = new Set(tables.map((table) => table.name));
  for (const table of EXPORTABLE_TABLES) {
    if (!names.has(table)) issues.push(`Missing export coverage for ${table}.`);
  }
  const countedTables = tables.filter((table) => typeof table.rowCount === "number");
  const totalRows = countedTables.length
    ? countedTables.reduce((sum, table) => sum + Number(table.rowCount), 0)
    : null;
  return {
    ok: issues.length === 0,
    version: EXPORT_VERSION,
    tableCount: EXPORTABLE_TABLES.length,
    nonEmptyTableCount: countedTables.filter((table) => Number(table.rowCount) > 0).length,
    totalRows,
    redactedFields: redactedFieldsFor(options),
    recoverySecretsIncluded: options?.includeRecoverySecrets === true,
    issues,
  };
}

function sanitizeRow<T extends Record<string, unknown>>(row: T, options?: { includeRecoverySecrets?: boolean }): T {
  const copy: Record<string, unknown> = { ...row };
  for (const field of redactedFieldsFor(options)) {
    if (field in copy) copy[field] = "[redacted]";
  }
  return copy as T;
}

function redactedFieldsFor(options?: { includeRecoverySecrets?: boolean }) {
  return Array.from(options?.includeRecoverySecrets ? RECOVERY_REDACTED_FIELDS : DEFAULT_REDACTED_FIELDS);
}
