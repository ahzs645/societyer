import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { createDownloadUrl } from "./providers/storage";

const EXPORT_VERSION = 2;

export const EXPORTABLE_TABLES = [
  "societies",
  "organizationAddresses",
  "organizationRegistrations",
  "organizationIdentifiers",
  "roleHolders",
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
  "signatures",
  "filingBotRuns",
  "aiAgentRuns",
  "aiAgentAuditEvents",
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
  "members",
  "directors",
  "boardRoleAssignments",
  "boardRoleChanges",
  "signingAuthorities",
  "committees",
  "committeeMembers",
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
  "motionTemplates",
  "motionBacklog",
  "recordsLocation",
  "sourceEvidence",
  "secretVaultItems",
  "archiveAccessions",
] as const;

const EXPORTABLE_SET = new Set<string>(EXPORTABLE_TABLES);
const DEFAULT_REDACTED_FIELDS = ["secretEncrypted", "tokenHash", "storageId"] as const;
const RECOVERY_REDACTED_FIELDS = ["storageId"] as const;
const GLOBAL_TABLES = new Set(["jurisdictionMetadata"]);
const OPTIONAL_SOCIETY_TABLES = new Set(["legalTemplateDataFields", "legalTemplates", "legalPrecedents"]);
const NO_BY_SOCIETY_INDEX = new Set(["transcriptionJobs", "electionEligibleVoters", "electionBallots", "viewFields"]);
const SOCIETY_INDEX_BY_TABLE: Record<string, string> = {
  budgets: "by_society_fy",
};

export const listExportableTables = query({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    if (!societyId) {
      return EXPORTABLE_TABLES.map((name) => ({ name, rowCount: null, exportable: true }));
    }
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    return EXPORTABLE_TABLES.map((name) => ({ name, rowCount: null, exportable: true }));
  },
});

export const exportTable = query({
  args: {
    societyId: v.id("societies"),
    table: v.string(),
    includeRecoverySecrets: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, table, includeRecoverySecrets }) => {
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
  },
});

export const exportTablePage = query({
  args: {
    societyId: v.id("societies"),
    table: v.string(),
    paginationOpts: paginationOptsValidator,
    includeRecoverySecrets: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, table, paginationOpts, includeRecoverySecrets }) => {
    return await paginateForSociety(ctx, table, societyId, paginationOpts, {
      includeRecoverySecrets: includeRecoverySecrets === true,
    });
  },
});

export const countTablePage = query({
  args: {
    societyId: v.id("societies"),
    table: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, { societyId, table, paginationOpts }) => {
    const result = await paginateForSociety(ctx, table, societyId, paginationOpts);
    return {
      count: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
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
  handler: async (ctx, { societyId, includeEmptyTables, includeRecoverySecrets }) => {
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
  },
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
  handler: async (ctx, { societyId }) => {
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
  },
});

async function paginateForSociety(
  ctx: any,
  table: string,
  societyId: string,
  paginationOpts: any,
  options?: { includeRecoverySecrets?: boolean },
) {
  assertExportable(table);
  const societyKey = String(societyId);

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
    return { ...page, page: page.page.map((row: any) => sanitizeRow(row, options)) };
  }

  if (table === "notificationPrefs") {
    const users = await ctx.db.query("users").collect();
    const userIds = new Set(
      users
        .filter((row: any) => String(row.societyId) === societyKey)
        .map((row: any) => String(row._id)),
    );
    if (userIds.size === 0) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const page = await ctx.db
      .query("notificationPrefs")
      .filter((q: any) => q.or(...Array.from(userIds).map((id) => q.eq(q.field("userId"), id))))
      .paginate(paginationOpts);
    return { ...page, page: page.page.map((row: any) => sanitizeRow(row, options)) };
  }

  if (OPTIONAL_SOCIETY_TABLES.has(table)) {
    const page = await ctx.db
      .query(table)
      .filter((q: any) =>
        q.or(q.eq(q.field("societyId"), societyId), q.eq(q.field("societyId"), undefined)),
      )
      .paginate(paginationOpts);
    return { ...page, page: page.page.map((row: any) => sanitizeRow(row, options)) };
  }

  const indexName = SOCIETY_INDEX_BY_TABLE[table] ?? "by_society";
  const query = NO_BY_SOCIETY_INDEX.has(table)
    ? ctx.db.query(table).filter((q: any) => q.eq(q.field("societyId"), societyId))
    : ctx.db.query(table).withIndex(indexName, (q: any) => q.eq("societyId", societyId));
  const page = await query.paginate(paginationOpts);
  return { ...page, page: page.page.map((row: any) => sanitizeRow(row, options)) };
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
