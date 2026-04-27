// @ts-nocheck
import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

const EXPORT_VERSION = 2;

export const EXPORTABLE_TABLES = [
  "societies",
  "organizationAddresses",
  "organizationRegistrations",
  "organizationIdentifiers",
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
  "meetingAttendanceRecords",
  "motionEvidence",
  "filings",
  "grants",
  "grantApplications",
  "grantReports",
  "grantTransactions",
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
const REDACTED_FIELDS = new Set(["secretEncrypted", "tokenHash", "storageId"]);
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
  },
  returns: v.any(),
  handler: async (ctx, { societyId, table }) => {
    const result = await paginateForSociety(ctx, table, societyId, { cursor: null, numItems: 100 });
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
  },
  returns: v.any(),
  handler: async (ctx, { societyId, table, paginationOpts }) => {
    return await paginateForSociety(ctx, table, societyId, paginationOpts);
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

export const exportWorkspace = query({
  args: {
    societyId: v.id("societies"),
    includeEmptyTables: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, includeEmptyTables }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");

    const generatedAtISO = new Date().toISOString();
    const summaries = EXPORTABLE_TABLES.map((name) => ({ name, rowCount: null, exportable: true }));

    return {
      kind: "societyer.workspaceExport",
      version: EXPORT_VERSION,
      generatedAtISO,
      society: sanitizeRow(society),
      manifest: {
        societyId,
        societyName: society.name,
        tableCount: EXPORTABLE_TABLES.length,
        exportedTableCount: includeEmptyTables ? EXPORTABLE_TABLES.length : 0,
        totalRows: null,
        redactedFields: Array.from(REDACTED_FIELDS),
        binaryFilesIncluded: false,
        tables: summaries,
      },
      validation: validationFromSummaries(summaries),
      tables: {},
    };
  },
});

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

async function paginateForSociety(ctx: any, table: string, societyId: string, paginationOpts: any) {
  assertExportable(table);
  const societyKey = String(societyId);

  if (table === "societies") {
    const society = await ctx.db.get(societyId);
    const include = society && (!paginationOpts.cursor || paginationOpts.cursor === "0");
    return {
      page: include ? [sanitizeRow(society)] : [],
      isDone: true,
      continueCursor: "",
    };
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
    return { ...page, page: page.page.map(sanitizeRow) };
  }

  const indexName = SOCIETY_INDEX_BY_TABLE[table] ?? "by_society";
  const query = NO_BY_SOCIETY_INDEX.has(table)
    ? ctx.db.query(table).filter((q: any) => q.eq(q.field("societyId"), societyId))
    : ctx.db.query(table).withIndex(indexName, (q: any) => q.eq("societyId", societyId));
  const page = await query.paginate(paginationOpts);
  return { ...page, page: page.page.map(sanitizeRow) };
}

function assertExportable(table: string) {
  if (!EXPORTABLE_SET.has(table)) {
    throw new Error(`Table "${table}" is not exportable.`);
  }
}

function validationFromSummaries(tables: Array<{ name: string; rowCount: number | null }>) {
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
    issues,
  };
}

function sanitizeRow<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  for (const field of REDACTED_FIELDS) {
    if (field in copy) copy[field] = "[redacted]";
  }
  return copy as T;
}
