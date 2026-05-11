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
  "meetingTemplates",
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
const GLOBAL_TABLES = new Set(["jurisdictionMetadata", "aiModelCatalogCache"]);
const OPTIONAL_SOCIETY_TABLES = new Set(["legalTemplateDataFields", "legalTemplates", "legalPrecedents"]);
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

export const previewWorkspaceImportTable = query({
  args: {
    societyId: v.id("societies"),
    table: v.string(),
    source: v.object({
      rowCount: v.number(),
      ids: v.array(v.string()),
      naturalKeys: v.array(v.string()),
      idSampled: v.optional(v.boolean()),
      naturalKeySampled: v.optional(v.boolean()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, table, source }) => {
    assertExportable(table);
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");

    const currentRows = await collectRowsForSociety(ctx, table, societyId, { includeRecoverySecrets: false });
    const currentIds = new Set(currentRows.map((row: any) => String(row._id)).filter(Boolean));
    const sourceIds = new Set<string>(source.ids.map(String).filter(Boolean));
    const overlappingIds = Array.from(sourceIds).filter((id) => currentIds.has(id));

    const currentNaturalKeys = new Set(
      currentRows
        .map((row: any) => naturalKeyForTable(table, row))
        .filter(Boolean) as string[],
    );
    const sourceNaturalKeys = new Set<string>(source.naturalKeys.map(String).filter(Boolean));
    const overlappingNaturalKeys = Array.from(sourceNaturalKeys).filter((key) => currentNaturalKeys.has(key));

    const existingRows = currentRows.length;
    const importRows = source.rowCount;
    const nonOverlappingRows = Math.max(0, importRows - overlappingIds.length);
    const issues: string[] = [];
    if (overlappingIds.length > 0) {
      issues.push(`${overlappingIds.length} row ID${overlappingIds.length === 1 ? "" : "s"} already exist in this table.`);
    }
    if (overlappingNaturalKeys.length > 0) {
      issues.push(`${overlappingNaturalKeys.length} natural-key match${overlappingNaturalKeys.length === 1 ? "" : "es"} found.`);
    }
    if (source.idSampled || source.naturalKeySampled) {
      issues.push("Overlap checks are sampled for this table because the export is large.");
    }

    return {
      table,
      exportable: true,
      importRows,
      existingRows,
      nonOverlappingRows,
      overlappingIds: overlappingIds.slice(0, 25),
      overlappingIdCount: overlappingIds.length,
      overlappingNaturalKeys: overlappingNaturalKeys.slice(0, 25),
      overlappingNaturalKeyCount: overlappingNaturalKeys.length,
      idSampled: source.idSampled === true,
      naturalKeySampled: source.naturalKeySampled === true,
      recommendedMode: importRows === 0
        ? "skip"
        : existingRows === 0
          ? "restore-empty"
          : overlappingIds.length > 0 || overlappingNaturalKeys.length > 0
            ? "merge-review"
            : "append-review",
      issues,
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
    const users = await ctx.db
      .query("users")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    const rows: any[] = [];
    for (const user of users) {
      rows.push(
        ...(await ctx.db
          .query("notificationPrefs")
          .withIndex("by_user", (q: any) => q.eq("userId", user._id))
          .collect()),
      );
    }
    return paginateCollectedRows(rows, paginationOpts, options);
  }

  if (OPTIONAL_SOCIETY_TABLES.has(table)) {
    const [globalRows, societyRows] = await Promise.all([
      ctx.db.query(table).withIndex("by_society", (q: any) => q.eq("societyId", undefined)).collect(),
      ctx.db.query(table).withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
    ]);
    return paginateCollectedRows([...globalRows, ...societyRows], paginationOpts, options);
  }

  const indexName = SOCIETY_INDEX_BY_TABLE[table] ?? "by_society";
  const query = ctx.db.query(table).withIndex(indexName, (q: any) => q.eq("societyId", societyId));
  const page = await query.paginate(paginationOpts);
  return { ...page, page: page.page.map((row: any) => sanitizeRow(row, options)) };
}

async function collectRowsForSociety(
  ctx: any,
  table: string,
  societyId: string,
  options?: { includeRecoverySecrets?: boolean },
) {
  const rows: any[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  do {
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error(`Pagination cursor repeated while previewing ${table}.`);
      seenCursors.add(cursor);
    }
    const result = await paginateForSociety(
      ctx,
      table,
      societyId,
      { cursor, numItems: 1000 },
      options,
    );
    rows.push(...(result.page ?? []));
    if (rows.length > 20_000) {
      throw new Error(`Table "${table}" is too large for one import preview. Add paged preview support before restoring it.`);
    }
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return rows;
}

function paginateCollectedRows(
  rows: any[],
  paginationOpts: { cursor?: string | null; numItems: number },
  options?: { includeRecoverySecrets?: boolean },
) {
  const start = paginationOpts.cursor ? Number(paginationOpts.cursor) : 0;
  const safeStart = Number.isFinite(start) && start > 0 ? start : 0;
  const end = safeStart + paginationOpts.numItems;
  const page = rows.slice(safeStart, end).map((row: any) => sanitizeRow(row, options));
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

function naturalKeyForTable(table: string, row: any): string | null {
  const valuesByTable: Record<string, unknown[]> = {
    societies: [row.name],
    organizationAddresses: [row.type, row.street ?? row.address, row.city, row.postalCode],
    organizationRegistrations: [row.jurisdiction, row.registrationNumber],
    organizationIdentifiers: [row.kind ?? row.type, row.number],
    roleHolders: [row.roleType, row.fullName ?? row.name, row.startDate],
    users: [row.email, row.name],
    apiClients: [row.name],
    pluginInstallations: [row.slug],
    paperlessConnections: [row.baseUrl],
    financialConnections: [row.provider, row.externalId ?? row.name],
    waveCacheResources: [row.provider, row.resourceType, row.externalId],
    financialAccounts: [row.externalId, row.name, row.accountType],
    financialTransactions: [row.externalId, row.date, row.amountCents],
    budgets: [row.fiscalYear],
    budgetSnapshots: [row.fiscalYear, row.scenario, row.createdAtISO],
    financialStatementImports: [row.fiscalYear, row.periodLabel, row.sourceDocumentId],
    workflows: [row.name, row.eventType],
    workflowRuns: [row.workflowId, row.startedAtISO],
    membershipFeePeriods: [row.name, row.effectiveFrom],
    fundingSources: [row.name, row.sourceType],
    objectMetadata: [row.nameSingular, row.namePlural],
    fieldMetadata: [row.objectMetadataId, row.name],
    views: [row.objectMetadataId, row.name],
    members: [row.email, row.firstName, row.lastName],
    directors: [row.email, row.firstName, row.lastName, row.startDate],
    boardRoleAssignments: [row.personName, row.roleTitle, row.startDate],
    boardRoleChanges: [row.personName, row.roleTitle, row.effectiveDate, row.changeType],
    signingAuthorities: [row.personName, row.institutionName, row.effectiveDate],
    committees: [row.name],
    committeeMembers: [row.committeeId, row.memberName ?? row.personName, row.role],
    orgChartAssignments: [row.subjectType, row.subjectId],
    volunteers: [row.email, row.name],
    volunteerApplications: [row.email, row.name, row.createdAtISO],
    meetings: [row.title, row.scheduledAt],
    minutes: [row.meetingId, row.heldAt],
    meetingMaterials: [row.meetingId, row.documentId],
    documents: [row.title, row.category, row.fileName, row.createdAtISO],
    documentVersions: [row.documentId, row.version, row.fileName],
    sourceEvidence: [row.externalId, row.sourceTitle],
    filings: [row.kind, row.dueDate, row.filedAt],
    grants: [row.title, row.program, row.confirmationCode],
    grantApplications: [row.grantId, row.submittedAtISO],
    grantEmployeeLinks: [row.grantId, row.employeeId],
    deadlines: [row.title, row.dueDate],
    commitments: [row.title, row.status],
    policies: [row.policyName ?? row.name, row.effectiveDate],
    goals: [row.title],
    tasks: [row.title, row.dueDate],
    activity: [row.entityType, row.entityId, row.createdAtISO, row.type],
    notes: [row.entityType, row.entityId, row.createdAtISO],
    invitations: [row.email, row.createdAtISO],
    inspections: [row.title, row.scheduledAt],
    writtenResolutions: [row.title, row.resolutionDate],
    agmRuns: [row.meetingId],
    noticeDeliveries: [row.meetingId, row.recipientEmail],
    insurancePolicies: [row.policyNumber, row.policyTermLabel, row.insurer],
    pipaTrainings: [row.participantName, row.completedAtISO],
    proxies: [row.memberId, row.meetingId],
    auditorAppointments: [row.auditorName, row.fiscalYear],
    memberProposals: [row.title, row.submittedAtISO],
    elections: [row.title, row.opensAtISO],
    electionQuestions: [row.electionId, row.title],
    electionEligibleVoters: [row.electionId, row.memberId],
    electionBallots: [row.electionId, row.voterId],
    donationReceipts: [row.receiptNumber, row.donorEmail],
    employees: [row.email, row.name],
    courtOrders: [row.title, row.orderDate],
    bylawAmendments: [row.title, row.filedAtISO],
    agendas: [row.meetingId, row.title],
    agendaItems: [row.agendaId, row.position, row.title],
    meetingTemplates: [row.name],
    motionTemplates: [row.title, row.category],
    motionBacklog: [row.title, row.createdAtISO],
    recordsLocation: [row.title, row.address],
    secretVaultItems: [row.service, row.name],
    archiveAccessions: [row.accessionNumber, row.title],
  };
  const values = valuesByTable[table];
  if (!values) return null;
  const cleaned = values.map((value) => normalizeKeyPart(value)).filter(Boolean);
  return cleaned.length ? `${table}:${cleaned.join("|")}` : null;
}

function normalizeKeyPart(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}
