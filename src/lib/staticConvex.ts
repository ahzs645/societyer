import { RECORD_TABLE_OBJECTS } from "../../convex/recordTableMetadataDefinitions";
import {
  CORPORATION_DOCUMENT_PACKETS,
  corporationPacketEntityTypes,
  corporationPacketPrecedentMarker,
  corporationPacketTemplateMarker,
} from "../../shared/corporationDocumentPackets";
import { BUILT_IN_GRANT_SOURCE_PROFILES, BUILT_IN_GRANT_SOURCES } from "../../shared/grantSourceLibrary";
import { buildOrgRevenueStatement } from "../../shared/orgRevenueStatement";
import { materializeRightsHoldings, validateLedger } from "../../shared/equityLedger";
import { planShareSplit, validateRatio, type HoldingPosition, type SplitRatio } from "../../shared/shareSplit";
import { postIncorporationStepsForOrganization } from "../../shared/postIncorporationSteps";
import { organizationKind, organizationLabel } from "../../shared/organizationDomain";
import {
  buildTimeline,
  changesBetween as changesBetweenPure,
  fieldChanges,
  planRoleHolderRevision,
  registerAsOf as registerAsOfPure,
  type LiveRoleHolder,
  type StoredRevision,
} from "../../shared/roleHolderHistory";
import { summarizeVotingPower, transfersAsOf } from "../../shared/functions/votingPower";
import { PortableRuntime } from "../../shared/portable/define";
import { LocalStoreDb } from "../../shared/portable/localRowStore";
import { buildLocalCapabilities } from "./localCapabilities";
import { PORTABLE_FUNCTIONS } from "../../shared/functions/registry";
import { SOCIETY_DOCUMENT_PACKETS, societyPacketEntityTypes } from "../../shared/societyDocumentPackets";
import {
  ycnQueryResult,
  ycnMutationResult,
  applyYcnDerivedFields,
  YCN_NOT_HANDLED,
} from "./staticConvexYcn";
import {
  staticSeedCorporationDocumentPackets,
  staticSeedSocietyDocumentPackets,
  staticCreatePacketRunArtifacts,
  staticStageCorporationDocumentPacket,
  staticGenerateDocumentFromCatalog,
} from "./staticConvexDocuments";
import { INTEGRATION_CATALOG } from "../../shared/integrationCatalog";
import { DEFAULT_HOME_JURISDICTION_CODE, registryOnboardingCopy } from "../../shared/jurisdictionWorkspace";
import { LocalDexieRowStore, type LocalSeed, type LocalWorkspaceSnapshot } from "./localDexieRowStore";
import { STATIC_OFFLINE_NOOP_WRITES } from "./staticConvexParity";
import {
  byId,
  staticCsvRows,
  dateOnlyStatic,
  inStaticYear,
  addStaticDays,
  staticMonthlyEstimateCents,
  staticAgendaItemType,
  normalizeStaticCategoryLabel,
  cycleItem,
  filingMatchesStaticYear,
  reportStaticWriteGap,
} from "./staticConvexUtils";
import { STATIC_DEMO_SOCIETY_ID, STATIC_DEMO_USER_ID } from "./staticIds";

const FUNCTION_NAME = Symbol.for("functionName");

import {
  SOCIETY_ID,
  USER_OWNER_ID,
  USER_TREASURER_ID,
  USER_SECRETARY_ID,
  MEETING_BOARD_ID,
  MEETING_AGM_ID,
  DOCUMENT_BYLAWS_ID,
  DOCUMENT_POLICY_ID,
  DOCUMENT_TENANCY_ID,
  DOCUMENT_PRESENTATION_ID,
  DOCUMENT_UNBC_GENERATED_ID,
  DOCUMENT_ANNUAL_REPORT_CONFIRMATION_ID,
  ELECTION_ID,
  ELECTION_QUESTION_ID,
  FINANCIAL_CONNECTION_ID,
  PAPERLESS_CONNECTION_ID,
  CASH_ACCOUNT_ID,
  GRANT_ACCOUNT_ID,
  ACCOUNT_RECEIVABLE_ID,
  ACCOUNT_PAYABLE_ID,
  ACCOUNT_NET_ASSETS_ID,
  ACCOUNT_GRANT_REVENUE_ID,
  ACCOUNT_DONATION_REVENUE_ID,
  ACCOUNT_PROGRAM_EXPENSE_ID,
  ACCOUNT_FACILITIES_EXPENSE_ID,
  ACCOUNT_EQUIPMENT_EXPENSE_ID,
  society,
  users,
  directors,
  orgHistoryBoardTerms,
  orgHistoryBundle,
  evidenceRegistersOverview,
  members,
  subscriptionPlans,
  memberSubscriptions,
  operatingSubscriptions,
  membershipFeePeriods,
  fundingSources,
  fundingSourceEvents,
  committees,
  meetings,
  agendas,
  agendaItems,
  minutes,
  filings,
  deadlines,
  commitments,
  commitmentEvents,
  documents,
  meetingMaterials,
  documentComments,
  expenseReports,
  elections,
  electionQuestions,
  electionEligibleVoters,
  electionAuditEvents,
  goals,
  tasks,
  conflicts,
  financials,
  financialConnections,
  WAVE_CACHE_SNAPSHOT_ID,
  waveCacheSnapshots,
  waveCacheResources,
  waveCacheStructures,
  paperlessConnections,
  paperlessDocumentSyncs,
  financialAccounts,
  financialTransactions,
  accountingFiscalPeriods,
  accountingCounterparties,
  fundRestrictions,
  accountingAccountMappings,
  journalEntries,
  journalLines,
  reconciliationRuns,
  reconciliationRunLines,
  budgets,
  notifications,
  bylawRules,
  workflowCatalog,
  workflows,
  workflowRuns,
  aiAgentDefinitions,
  aiSkills,
  aiToolCatalog,
  aiAgentRuns,
  aiAgentAuditEvents,
  aiChatThreads,
  aiMessages,
  aiProviderSettings,
  motions,
  tables,
  director,
  member,
  waveResource,
  waveStructure,
} from "./staticConvexFixtures";
import type {
  StaticArgs,
} from "./staticConvexFixtures";

const staticRecordTableDefinitions = new Map(
  RECORD_TABLE_OBJECTS.map((definition) => [definition.nameSingular, definition]),
);



function functionName(ref: any) {
  if (typeof ref === "string") return ref;
  const name = ref?.[FUNCTION_NAME];
  return typeof name === "string" ? name : "";
}

// A frontend write reached the static mirror with no handler and no generic-CRUD
// match, and it is not an intentional offline no-op. Rather than silently drop
// the write (the old behaviour, which lost ballots/signatures/etc. with no
// signal), surface it: throw in dev so the gap is impossible to miss, warn in
// production so a shipped demo/desktop build degrades instead of crashing. The
// CI parity gate (scripts/check-static-convex-parity.ts) is the real backstop
// that keeps this from ever firing in a correctly-maintained build.


// Mirror of convex/lib/permissions ROLE_MATRIX for the offline/demo runtime so
// usePermissions() shows an accurate role + permission set without a backend.
const STATIC_PERMISSIONS = [
  "society:read", "society:write", "society:update", "members:read", "members:write",
  "directors:read", "directors:write", "employees:read", "employees:write", "committees:read",
  "committees:write", "meetings:read", "meetings:write", "minutes:read", "minutes:write",
  "minutes:approve", "agendas:read", "agendas:write", "motions:read", "motions:write",
  "proxies:read", "proxies:write", "conflicts:read", "conflicts:write", "attestations:read",
  "attestations:write", "auditors:read", "auditors:write", "courtOrders:read", "courtOrders:write",
  "filings:read", "filings:write", "filings:submit", "deadlines:read", "deadlines:write",
  "commitments:read", "commitments:write", "financials:read", "financials:write", "elections:read",
  "elections:write", "elections:tally", "grants:read", "grants:write", "documents:read",
  "documents:write", "users:read", "users:write", "tasks:read", "tasks:write", "exports:read",
  "exports:download", "settings:read", "settings:write", "settings:manage", "audit:read",
  "volunteers:read", "volunteers:write", "communications:read", "communications:write",
];
function staticPermissionsForRole(role: string): string[] {
  const reads = STATIC_PERMISSIONS.filter((p) => p.endsWith(":read"));
  if (role === "Owner") return STATIC_PERMISSIONS;
  if (role === "Admin") return STATIC_PERMISSIONS.filter((p) => p !== "settings:manage");
  if (role === "Director") return [...reads, "meetings:write", "minutes:write", "agendas:write", "documents:write", "exports:download"];
  if (role === "Member") return ["society:read", "members:read", "meetings:read", "minutes:read", "elections:read", "documents:read", "grants:read", "agendas:read", "motions:read", "volunteers:read", "communications:read", "tasks:read"];
  return reads; // Viewer
}











function scopedRows(rows: any[], args: StaticArgs) {
  if (!args?.societyId) return rows;
  return rows.filter((row) => !row.societyId || row.societyId === args.societyId);
}









// Reads that should reflect writes (e.g. CSV-imported rows) prefer the local
// store when one is active, falling back to the module fixtures for non-store
// contexts (SSR, tests). financialTransactions/financialAccounts are seeded into
// the store, so listRows returns the full set including anything imported.














// Read the ordered agenda items for a meeting from the static agenda fixtures
// (agendas + agendaItems). The relational store is the single source of truth.











const STATIC_EXPORT_TABLES = [
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
  "signatureProfiles",
  "filingBotRuns",
  "legalTemplateDataFields",
  "legalTemplates",
  "legalPrecedents",
  "legalPrecedentRuns",
  "generatedLegalDocuments",
  "legalSigners",
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
  "meetingAttendanceRecords",
  "motionEvidence",
  "roleHolders",
  "rightsClasses",
  "rightsholdingTransfers",
  "rightsHoldings",
  "filings",
  "complianceRemediations",
  "grants",
  "grantApplications",
  "grantReports",
  "grantTransactions",
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
  "financialAccounts",
  "financialTransactions",
  "accountingFiscalPeriods",
  "accountingCounterparties",
  "accountingAccountMappings",
  "fundRestrictions",
  "journalEntries",
  "journalLines",
  "reconciliationRuns",
  "reconciliationRunLines",
  "bylawRuleSets",
  "goals",
  "tasks",
  "assets",
  "assetEvents",
  "assetMaintenance",
  "assetVerificationRuns",
  "assetVerificationItems",
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
  "meetingTemplates",
  "motionTemplates",
  "recordsLocation",
  "sourceEvidence",
  "secretVaultItems",
  "archiveAccessions",
];

const STATIC_EXPORT_ALIASES: Record<string, string> = {
  donationReceipts: "receipts",
  insurancePolicies: "insurance",
  pipaTrainings: "pipaTraining",
  publications: "transparency",
  secretVaultItems: "secrets",
};







const QUERY_NOT_HANDLED = Symbol("staticConvex.queryNotHandled");

function queryCasesActivity1(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "aiAgents:getToolCatalog": {
      const catalog: Record<string, any[]> = {};
      aiToolCatalog.forEach((tool) => {
        catalog[tool.category as string] ??= [];
        catalog[tool.category as string].push(tool);
      });
      return { role: "Owner", categories: Object.keys(catalog), catalog, tools: aiToolCatalog };
    }
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesInventoryHub2(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "aiAgents:getChatContext": {
      const catalog: Record<string, any[]> = {};
      aiToolCatalog.forEach((tool) => {
        catalog[tool.category as string] ??= [];
        catalog[tool.category as string].push(tool);
      });
      return {
        role: "Owner",
        user: { id: USER_OWNER_ID, displayName: "Mina Patel", role: "Owner" },
        skillCatalog: aiSkills,
        toolCatalog: catalog,
        browsingContext: args?.browsingContext ?? null,
        systemPrompt: "You are Societyer's AI assistant. Follow Plan -> Skill -> Learn -> Execute.",
      };
    }
    case "aiAgents:learnTools": {
      const names = new Set(args?.toolNames ?? []);
      const tools = aiToolCatalog
        .filter((tool) => names.has(tool.name))
        .map((tool) => ({ ...tool, inputSchema: { type: "object", additionalProperties: true } }));
      return { tools, notFound: [...names].filter((name) => !tools.some((tool) => tool.name === name)), message: `Learned ${tools.length} tool(s).` };
    }
    case "aiAgents:executeTool":
      return { success: true, toolName: args?.toolName, rows: [] };
    case "aiAgents:listRuns":
      return aiAgentRuns.slice(0, args?.limit ?? aiAgentRuns.length);
    case "aiAgents:auditForRun":
      return aiAgentAuditEvents.filter((event) => event.runId === args?.runId);
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesAgendas3(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "paperless:connectionStatus":
      return {
        connection: paperlessConnections[0],
        runtime: {
          provider: "demo",
          live: false,
          configured: false,
          baseUrl: "demo://paperless-ngx",
        },
      };
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesPaperless4(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "paperless:tagProfiles":
      return [
        {
          scope: "Core record",
          tags: ["societyer", "category:<document category>", "local document tags"],
          usage: "Every synced document carries stable app-level context.",
        },
        {
          scope: "Governance",
          tags: ["constitution", "bylaws", "minutes", "election", "auditor"],
          usage: "Society profile, meetings, elections, bylaws, and auditor records.",
        },
        {
          scope: "Compliance",
          tags: ["filing", "filing:<kind>", "records-inspection", "pipa-training"],
          usage: "Filing evidence, retained records, inspections, and privacy training proof.",
        },
        {
          scope: "Finance and programs",
          tags: ["financial-statement", "grant-report", "grant-transaction", "volunteer-screening"],
          usage: "Financials, grants, donation evidence, and volunteer screening files.",
        },
      ];
    case "filingBot:buildFilingPacket":
      return { filing: byId(filings, args?.filingId), documents: [] };
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesAccounting5(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "financialHub:oauthUrl":
      return { provider: "wave", live: false, demoAvailable: true };
  }
  return QUERY_NOT_HANDLED;
}



function queryCasesTransparency8(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "permissions:myPermissions": {
      const permUser = store?.getRow("users", args?.userId) ?? byId(users, args?.userId) ?? users[0];
      return { role: permUser?.role ?? "Owner", permissions: staticPermissionsForRole(permUser?.role ?? "Owner") };
    }
    case "permissions:check": {
      const permUser = store?.getRow("users", args?.userId) ?? byId(users, args?.userId) ?? users[0];
      return staticPermissionsForRole(permUser?.role ?? "Owner").includes(args?.permission);
    }
    case "workflows:listCatalog":
      return workflowCatalog;
    case "workflows:get":
      return byId(workflows, args?.id);
  }
  return QUERY_NOT_HANDLED;
}

const QUERY_DISPATCHERS = [
  queryCasesActivity1,
  queryCasesInventoryHub2,
  queryCasesAgendas3,
  queryCasesPaperless4,
  queryCasesAccounting5,
  queryCasesTransparency8,
];

function queryResult(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  for (const dispatch of QUERY_DISPATCHERS) {
    const result = dispatch(name, args, store);
    if (result !== QUERY_NOT_HANDLED) return result;
  }

  const [moduleName, exportName] = name.split(":");
  const tableName = staticTableNameForModule(moduleName);
  if (moduleName === "society" && exportName === "get") {
    const localSocieties = store?.listRows("societies", {});
    if (store && localSocieties && localSocieties.length === 0) return null;
    return store?.getRow("societies", args?.id ?? localSocieties?.[0]?._id ?? SOCIETY_ID) ?? society;
  }
  if (moduleName === "complianceObligations" && exportName === "listDecisions") {
    return store?.listRows("complianceRemediations", args) ?? [];
  }
  if (moduleName === "organizationDetails" && exportName === "overview") {
    return {
      addresses: store?.listRows("organizationAddresses", args) ?? [],
      registrations: store?.listRows("organizationRegistrations", args) ?? [],
      identifiers: store?.listRows("organizationIdentifiers", args) ?? [],
    };
  }
  if (moduleName === "legalOperations" && exportName === "listRoleHolders") {
    return (store?.listRows("roleHolders", args) ?? [])
      .sort((a, b) => String(a.fullName ?? "").localeCompare(String(b.fullName ?? "")));
  }
  if (moduleName === "firm" && exportName === "overview") {
    const today = (args?.todayISO ?? new Date().toISOString()).slice(0, 10);
    const societies = store?.listRows("societies", {}) ?? [];
    const entities = societies.map((society: any) => {
      const deadlines = store?.listRows("deadlines", { societyId: society._id }) ?? [];
      const open = deadlines.filter((d: any) => (d.status ?? (d.done ? "complete" : "open")) === "open");
      const overdue = open.filter((d: any) => String(d.dueDate ?? "") < today).length;
      const runs = store?.listRows("legalPrecedentRuns", { societyId: society._id }) ?? [];
      const generated = new Set<string>();
      for (const run of runs) {
        for (const id of run.sourceExternalIds ?? []) {
          const m = /-packet-run:(.+)$/.exec(String(id));
          if (m) generated.add(m[1]);
        }
      }
      const packetSteps = postIncorporationStepsForOrganization(society).filter((s) => s.packetKey);
      return {
        _id: society._id,
        name: organizationLabel(society),
        kind: organizationKind(society),
        incorporationNumber: society.incorporationNumber ?? null,
        status: society.organizationStatus ?? null,
        overdueDeadlines: overdue,
        upcomingDeadlines: open.length - overdue,
        openDeadlines: open.length,
        postIncorpTotal: packetSteps.length,
        postIncorpDone: packetSteps.filter((s) => generated.has(s.packetKey as string)).length,
      };
    });
    entities.sort((a, b) => b.overdueDeadlines - a.overdueDeadlines || a.name.localeCompare(b.name));
    return {
      today,
      entities,
      totals: {
        entities: entities.length,
        corporations: entities.filter((e) => e.kind === "corporation").length,
        societies: entities.filter((e) => e.kind === "society").length,
        overdueDeadlines: entities.reduce((s, e) => s + e.overdueDeadlines, 0),
        upcomingDeadlines: entities.reduce((s, e) => s + e.upcomingDeadlines, 0),
      },
    };
  }
  if (moduleName === "postIncorporation" && exportName === "checklist") {
    const society = store?.getRow("societies", args?.societyId);
    if (!society) return { steps: [], generatedPacketKeys: [] };
    const steps = postIncorporationStepsForOrganization(society as any);
    const generated = new Set<string>();
    for (const run of store?.listRows("legalPrecedentRuns", { societyId: args?.societyId }) ?? []) {
      for (const id of run.sourceExternalIds ?? []) {
        const match = /^societyer:corporation-packet-run:(.+)$/.exec(String(id));
        if (match) generated.add(match[1]);
      }
    }
    return { steps, generatedPacketKeys: Array.from(generated) };
  }
  if (moduleName === "roleHolderHistory" && exportName === "revisionHistory") {
    const revisions = staticStoredRoleHolderRevisions(store, { roleHolderId: args?.roleHolderId });
    const liveRow = store?.getRow("roleHolders", args?.roleHolderId);
    const timeline = buildTimeline(revisions, liveRow ? ({ ...liveRow, _id: String(liveRow._id) } as LiveRoleHolder) : undefined);
    return timeline.map((version, index) => ({
      enteredAtISO: version.enteredAtISO,
      enteredByUserId: version.enteredByUserId ?? null,
      supersededAtISO: version.supersededAtISO ?? null,
      supersededByUserId: version.supersededByUserId ?? null,
      isCurrent: version.supersededAtISO == null,
      fullName: version.fullName ?? null,
      changes: fieldChanges(index === 0 ? undefined : timeline[index - 1], version),
    }));
  }
  if (moduleName === "roleHolderHistory" && exportName === "registerAsOf") {
    const revisions = staticStoredRoleHolderRevisions(store, { societyId: args?.societyId });
    const liveRows = (store?.listRows("roleHolders", { societyId: args?.societyId }) ?? [])
      .map((row: any) => ({ ...row, _id: String(row._id) })) as LiveRoleHolder[];
    return registerAsOfPure(revisions, liveRows, String(args?.asOfISO ?? ""));
  }
  if (moduleName === "roleHolderHistory" && exportName === "changesBetween") {
    const revisions = staticStoredRoleHolderRevisions(store, { societyId: args?.societyId });
    const liveRows = (store?.listRows("roleHolders", { societyId: args?.societyId }) ?? [])
      .map((row: any) => ({ ...row, _id: String(row._id) })) as LiveRoleHolder[];
    return changesBetweenPure(revisions, liveRows, String(args?.fromISO ?? ""), String(args?.toISO ?? ""))
      .map((row) => ({ op: row.op, key: row.key, name: String((row.desired ?? row.current)?.fullName ?? "") }));
  }
  {
    const ycn = ycnQueryResult(moduleName, exportName, args, store as any);
    if (ycn !== YCN_NOT_HANDLED) return ycn;
  }
  if (moduleName === "legalOperations" && exportName === "rightsLedger") {
    const classes = (store?.listRows("rightsClasses", args) ?? [])
      .sort((a, b) => String(a.className ?? "").localeCompare(String(b.className ?? "")));
    const allTransfers = store?.listRows("rightsholdingTransfers", args) ?? [];
    const scoped = args?.asOf
      ? allTransfers.filter((t: any) => String(t.transferDate ?? t.createdAtISO ?? "").slice(0, 10) <= args.asOf)
      : allTransfers;
    const holdings = args?.asOf
      ? materializeRightsHoldings(scoped as any)
      : (store?.listRows("rightsHoldings", args) ?? [])
          .sort((a, b) => String(a.rightsClassId ?? "").localeCompare(String(b.rightsClassId ?? "")) || String(a.holderKey ?? "").localeCompare(String(b.holderKey ?? "")));
    const transfers = [...scoped]
      .sort((a, b) => String(b.transferDate ?? b.createdAtISO ?? "").localeCompare(String(a.transferDate ?? a.createdAtISO ?? "")));
    const roleHolders = (store?.listRows("roleHolders", args) ?? [])
      .sort((a, b) => String(a.fullName ?? "").localeCompare(String(b.fullName ?? "")));
    return { classes, holdings, transfers, roleHolders };
  }
  if (moduleName === "legalOperations" && exportName === "votingPower") {
    // The marshalling lives once in shared/functions/votingPower.ts and is shared
    // with the Convex handler (convex/legalOperations.ts). This sync path loads
    // rows from the local store; Phase 1 replaces it with the portable handler run
    // on the Dexie-backed ctx.db once the local reactive path goes async.
    // See docs/portable-functions-architecture.md.
    const classes = store?.listRows("rightsClasses", args) ?? [];
    const holdings = args?.asOf
      ? materializeRightsHoldings(
          transfersAsOf(store?.listRows("rightsholdingTransfers", args) ?? [], args.asOf) as any,
        )
      : store?.listRows("rightsHoldings", args) ?? [];
    const roleHolders = store?.listRows("roleHolders", args) ?? [];
    const directory = store?.listRows("peopleDirectory", {}) ?? [];
    return summarizeVotingPower({ classes, holdings, roleHolders, directory });
  }
  if (moduleName === "legalOperations" && exportName === "templateEngine") {
    return staticTemplateEngine(store, args);
  }
  if (moduleName === "calendarFeed" && exportName === "getFeedToken") {
    const soc = store?.getRow("societies", args?.societyId) ?? society;
    return soc?.calendarFeedToken ?? null;
  }
  if (moduleName === "orgChartAssignments" && exportName === "listAsOf") {
    // Offline demo has no revision history, so as-of falls back to current.
    return store?.listRows("orgChartAssignments", { societyId: args?.societyId }) ?? [];
  }
  if (moduleName === "partyPortals" && exportName === "list") {
    return (store?.listRows("partyPortals", { societyId: args?.societyId }) ?? [])
      .sort((a: any, b: any) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  }
  if (moduleName === "partyPortals" && exportName === "center") return null;
  // motionBacklog.list = motions with an early lifecycle status, mapped back to
  // the backlog-item shape the frontend reads (status/priority/motionText).
  if (moduleName === "motionBacklog" && exportName === "list") {
    const backlogStatuses = new Set(["Backlog", "Tabled", "Deferred", "Agenda"]);
    const rows = store?.listRows("motions", { societyId: args?.societyId })
      ?? scopedRows(tables.motions ?? [], args);
    return rows
      .filter((row: any) => backlogStatuses.has(String(row.status ?? "Backlog")))
      .map((row: any) => ({ ...row, motionText: row.text ?? "", priority: row.backlogPriority }));
  }
  // motionBacklog.suggestForMeeting = tabled/deferred/backlog motions not yet on
  // this meeting's agenda, planned-for-this-meeting first. Mirrors the server.
  if (moduleName === "motionBacklog" && exportName === "suggestForMeeting") {
    const meetingId = args?.meetingId;
    const meeting = store?.getRow("meetings", meetingId) ?? byId(tables.meetings ?? [], meetingId);
    if (!meeting) return [];
    const suggestible = new Set(["Backlog", "Tabled", "Deferred"]);
    const agendaIds = new Set(
      (store?.listRows("agendas", {}) ?? tables.agendas ?? [])
        .filter((a: any) => String(a.meetingId) === String(meetingId))
        .map((a: any) => String(a._id)),
    );
    const linked = new Set(
      (store?.listRows("agendaItems", {}) ?? tables.agendaItems ?? [])
        .filter((it: any) => agendaIds.has(String(it.agendaId)) && it.motionId)
        .map((it: any) => String(it.motionId)),
    );
    const rows = store?.listRows("motions", { societyId: meeting.societyId })
      ?? scopedRows(tables.motions ?? [], { societyId: meeting.societyId });
    return rows
      .filter((row: any) => suggestible.has(String(row.status ?? "Backlog")))
      .filter((row: any) => !linked.has(String(row._id)))
      .map((row: any) => ({
        ...row,
        motionText: row.text ?? "",
        priority: row.backlogPriority,
        isPlanned: String(row.targetMeetingId ?? "") === String(meetingId),
      }))
      .sort((a: any, b: any) => (a.isPlanned === b.isPlanned ? 0 : a.isPlanned ? -1 : 1));
  }
  if (moduleName === "firm" && exportName === "search") {
    const q = String(args?.query ?? "").trim().toLowerCase();
    if (q.length < 2) return [];
    const socs = store?.listRows("societies", {}) ?? [society];
    const nameById = new Map(socs.map((s: any) => [String(s._id), s.name]));
    const results: any[] = [];
    for (const d of store?.listRows("deadlines", {}) ?? []) {
      if (String(d.title ?? "").toLowerCase().includes(q)) {
        results.push({ kind: "deadline", id: String(d._id), title: d.title, societyId: String(d.societyId), societyName: nameById.get(String(d.societyId)) ?? "Entity", to: "/app/deadlines" });
      }
    }
    for (const d of store?.listRows("documents", {}) ?? []) {
      if (String(d.title ?? "").toLowerCase().includes(q)) {
        results.push({ kind: "document", id: String(d._id), title: d.title, societyId: String(d.societyId), societyName: nameById.get(String(d.societyId)) ?? "Entity", to: "/app/documents" });
      }
    }
    for (const p of store?.listRows("peopleDirectory", {}) ?? []) {
      if (String(p.fullName ?? "").toLowerCase().includes(q)) {
        results.push({ kind: "person", id: String(p._id), title: p.fullName, societyId: null, societyName: null, to: "/app/people-directory" });
      }
    }
    return results.slice(0, 30);
  }
  if (moduleName === "society" && exportName === "list") return store?.listRows("societies", args) ?? [society];
  if (exportName === "list") return store?.listRows(tableName, args) ?? scopedRows(tables[tableName] ?? [], args);
  if (exportName === "get") return store?.getRow(tableName, args?.id) ?? byId(tables[tableName] ?? [], args?.id);
  // Nothing above recognizes this query. `[]` is a safe historical default for
  // non-portable queries (most consumers do `data ?? []`), but for a *portable*
  // query in-flight on its real async handler, handing back `[]` here is a
  // truthy-but-wrong-shaped stub for any query that actually resolves to a
  // single object/null — `const { x } = data` then crashes on the very first
  // render, before the real async result has a chance to replace it. Calls from
  // the portable bridge translate this sentinel to `undefined` (i.e. "loading")
  // instead; non-portable callers keep getting `[]` via QUERY_RESULT_NOT_MIRRORED.
  return QUERY_RESULT_NOT_MIRRORED;
}

const QUERY_RESULT_NOT_MIRRORED = Symbol("staticConvex.queryResultNotMirrored");

function mutableQueryResult(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null) {
  const result = store?.queryResult(name, args) ?? queryResult(name, args, store);
  return result === QUERY_RESULT_NOT_MIRRORED ? [] : result;
}

/**
 * Synchronous placeholder for a portable query before its first async result
 * lands (see watchPortableQuery). Unlike `mutableQueryResult`, a query this
 * file has no real mirror for resolves to `undefined` ("loading") rather than
 * `[]`, since the portable handler may return a single object/null and a
 * `[]` stub would crash any code that destructures the resolved shape.
 */
function portableSyncStub(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null) {
  const result = store?.queryResult(name, args) ?? queryResult(name, args, store);
  return result === QUERY_RESULT_NOT_MIRRORED ? undefined : result;
}

const MUT_NOT_HANDLED = Symbol("staticConvex.mutationNotHandled");

function mutCasesSociety1(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "society:createWorkspace") {
    const now = new Date().toISOString();
    const societyId = staticLocalId("society", "workspace");
    const workflowId = staticLocalId("workflow", "onboarding");
    const jurisdictionCode = args?.jurisdictionCode ?? DEFAULT_HOME_JURISDICTION_CODE;
    const homeJurisdictionCode = args?.homeJurisdictionCode ?? jurisdictionCode;
    const anniversaryDate = args?.anniversaryDate ?? args?.incorporationDate;
    const homeRegistrationId = staticLocalId("organizationRegistration", "home");
    const taskSeeds = staticWorkspaceOnboardingTaskSeeds(jurisdictionCode);
    const taskIds = taskSeeds.map(({ key }) => staticLocalId("task", `onboarding_${key}`));
    store?.upsertRow("societies", {
      _id: societyId,
      _creationTime: Date.now(),
      name: args?.name,
      incorporationNumber: args?.incorporationNumber,
      incorporationDate: args?.incorporationDate,
      fiscalYearEnd: args?.fiscalYearEnd,
      jurisdictionCode,
      homeJurisdictionCode,
      primaryRegistrationId: homeRegistrationId,
      anniversaryDate,
      corporationKeyVaultItemId: args?.corporationKeyVaultItemId,
      entityType: args?.entityType,
      actFormedUnder: args?.actFormedUnder,
      officialEmail: args?.officialEmail,
      organizationStatus: args?.organizationStatus ?? "active",
      registeredOfficeAddress: args?.registeredOfficeAddress,
      mailingAddress: args?.mailingAddress,
      purposes: args?.purposes,
      privacyOfficerName: args?.privacyOfficerName,
      privacyOfficerEmail: args?.privacyOfficerEmail,
      isCharity: args?.isCharity === true,
      isMemberFunded: args?.isMemberFunded === true,
      distributing: args?.distributing === true,
      disabledModules: [],
      createdAtISO: now,
      updatedAtISO: now,
    });
    // Auto-seed the entity's document packet catalog by kind (mirrors
    // convex/society.createWorkspace), unless the caller opts out.
    if (args?.seedDocumentPackets !== false) {
      const isCorp = String(args?.entityType ?? "").includes("corporation") || String(args?.actFormedUnder ?? "").includes("corporations_act");
      if (isCorp) staticSeedCorporationDocumentPackets(store, { societyId });
      else staticSeedSocietyDocumentPackets(store, { societyId });
    }
    store?.upsertRow("organizationRegistrations", {
      _id: homeRegistrationId,
      _creationTime: Date.now(),
      societyId,
      registrationType: "home",
      jurisdiction: homeJurisdictionCode,
      homeJurisdiction: homeJurisdictionCode,
      registrationNumber: args?.incorporationNumber,
      registrationDate: args?.incorporationDate,
      officialEmail: args?.officialEmail,
      representativeIds: [],
      status: "active",
      notes: "Created automatically from the workspace home jurisdiction.",
      createdAtISO: now,
      updatedAtISO: now,
    });
    store?.upsertRow("workflows", {
      _id: workflowId,
      _creationTime: Date.now(),
      societyId,
      title: "Workspace onboarding",
      status: "Active",
      kind: "onboarding",
      createdByUserId: args?.actingUserId,
      createdAtISO: now,
      updatedAtISO: now,
    });
    taskSeeds.forEach(({ title, description }, index) => {
      store?.upsertRow("tasks", {
        _id: taskIds[index],
        _creationTime: Date.now() + index,
        societyId,
        title,
        description,
        status: "Todo",
        priority: index === 0 ? "High" : "Medium",
        workflowId,
        createdByUserId: args?.actingUserId,
        createdAtISO: now,
        updatedAtISO: now,
      });
    });
    store?.upsertRow("activity", {
      _id: staticLocalId("activity", "workspace"),
      _creationTime: Date.now(),
      societyId,
      actor: "Desktop user",
      entityType: "society",
      entityId: societyId,
      action: "workspace-created",
      summary: `Created ${args?.name ?? "workspace"}`,
      createdAtISO: now,
    });
    return { societyId, workflowId, taskIds };
  }

  {
    const ycn = ycnMutationResult(name, args, store as any, staticLocalId, society);
    if (ycn !== YCN_NOT_HANDLED) return ycn;
  }

  if (name === "firm:batchGeneratePacket") {
    const wantKind = CORPORATION_DOCUMENT_PACKETS.some((p) => p.key === args?.packetKey)
      ? "corporation"
      : SOCIETY_DOCUMENT_PACKETS.some((p) => p.key === args?.packetKey)
        ? "society"
        : null;
    const results: Array<{ societyId: string; ok: boolean; runId?: string; error?: string }> = [];
    for (const societyId of (args?.societyIds ?? []) as string[]) {
      const society = store?.getRow("societies", societyId);
      if (society && wantKind && organizationKind(society) !== wantKind) {
        results.push({ societyId, ok: false, error: `skipped: ${args?.packetKey} applies to ${wantKind} entities` });
        continue;
      }
      try {
        const r = staticGenerateDocumentFromCatalog(
          store,
          { societyId, packetKey: args?.packetKey, effectiveDate: args?.effectiveDate },
          staticLocalId,
          staticUniqueStrings,
        );
        results.push({ societyId, ok: true, runId: String(r?.runId) });
      } catch (err: any) {
        results.push({ societyId, ok: false, error: err?.message ?? String(err) });
      }
    }
    return {
      packetKey: args?.packetKey,
      generated: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  return MUT_NOT_HANDLED;
}

function mutCasesImportSessions2(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "aiChatActions:sendChatMessage") {
    const now = new Date().toISOString();
    const threadId = args?.threadId ?? mutationResult("aiChat:createThread", {
      societyId: args?.societyId,
      title: args?.content,
      actingUserId: args?.actingUserId,
    });
    aiMessages.push({
      _id: `static_ai_message_user_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      threadId,
      role: "user",
      content: args?.content ?? "",
      status: "complete",
      createdAtISO: now,
    });
    const content = [
      "Static AI chat reply.",
      "",
      "This route is wired to the same skill catalog and tool catalog as live Convex.",
      "Set OPENAI_API_KEY or OPENROUTER_API_KEY in a real deployment to stream through the Vercel AI SDK.",
    ].join("\n");
    const message = {
      _id: `static_ai_message_assistant_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      threadId,
      role: "assistant",
      content,
      status: "complete",
      provider: "static_fallback",
      createdAtISO: now,
    };
    aiMessages.push(message);
    return { threadId, messageId: message._id, content, provider: "static_fallback" };
  }
  if (name === "aiSettingsActions:validateProviderKey") {
    const provider = args?.provider ?? "openai";
    const modelCatalog = staticModelCatalog(provider);
    return {
      ok: Boolean(args?.apiKey),
      provider,
      baseUrl: args?.baseUrl ?? (provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1"),
      message: args?.apiKey ? "Static provider key validated." : "API key is required.",
      modelIds: modelCatalog.models.map((model: any) => model.id),
      modelCatalog,
    };
  }
  if (name === "aiSettingsActions:listProviderModels") {
    return staticModelCatalog(args?.provider ?? "openai");
  }
  if (name === "secrets:create") {
    return `static_secret_${Date.now()}`;
  }
  return MUT_NOT_HANDLED;
}

function mutCasesAiAgents3(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "aiAgents:executeTool") {
    if (args?.toolName === "draft_task") {
      const now = new Date().toISOString();
      const draft = {
        _id: `static_ai_tool_draft_${Date.now()}`,
        _creationTime: Date.now(),
        societyId: args?.societyId ?? SOCIETY_ID,
        threadId: args?.threadId,
        runId: args?.runId,
        agentKey: args?.agentKey,
        toolName: "draft_task",
        title: args?.arguments?.title ?? "AI drafted task",
        payload: { status: "draft", priority: "Medium", tags: [], ...(args?.arguments ?? {}) },
        status: "draft",
        createdAtISO: now,
        updatedAtISO: now,
      };
      // Write to the shared row store (not the in-memory fixture array) so the
      // now-portable aiAgents:listToolDrafts / approveToolDraft handlers, which
      // read ctx.db, see this draft.
      store?.upsertRow("aiToolDrafts", draft);
      return { success: true, draftId: draft._id, draft: draft.payload };
    }
    return { success: true, toolName: args?.toolName, rows: [], recordReferences: [] };
  }
  if (name === "aiAgents:runAgent" || name === "aiChatActions:runAgentLive") {
    const agent = aiAgentDefinitions.find((item) => item.key === args?.agentKey) ?? aiAgentDefinitions[0];
    const now = new Date().toISOString();
    const run = {
      _id: `static_ai_agent_run_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      agentKey: agent.key,
      agentName: agent.name,
      status: "completed",
      input: args?.input ?? "",
      inputHints: agent.requiredInputHints,
      scope: agent.scope,
      allowedActions: agent.allowedActions,
      allowedTools: agent.allowedTools,
      loadedSkillNames: agent.skillNames ?? [],
      toolCatalogSnapshot: aiToolCatalog.filter((tool) => agent.allowedTools.includes(tool.name)),
      unavailableTools: [],
      plannedToolCalls: agent.allowedTools.map((toolName: string) => ({
        toolName,
        purpose: `Use ${toolName} within the agent scope.`,
        status: "planned",
      })),
      output: staticAgentOutput(agent, args?.input ?? ""),
      provider: "deterministic_skill_router",
      createdAtISO: now,
      completedAtISO: now,
      triggeredByUserId: args?.actingUserId,
    };
    aiAgentRuns.unshift(run);
    return {
      runId: run._id,
      output: run.output,
      plannedToolCalls: run.plannedToolCalls,
      loadedSkills: aiSkills.filter((skill) => (agent.skillNames ?? []).includes(skill.name)),
      learnedTools: run.toolCatalogSnapshot,
      unavailableTools: [],
    };
  }
  if (name === "workflows:setupGovernanceN8nRecipes") {
    return {
      created: ["AGM date set -> generate deadlines", "Filing due in 14 days -> notify officer", "Conflict disclosed -> add board agenda item"],
      updated: [],
    };
  }
  return MUT_NOT_HANDLED;
}

function mutCasesAccounting4(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "financialHub:importBankCsvTransactions") {
    const account =
      store?.getRow("financialAccounts", args?.accountId) ?? byId(financialAccounts, args?.accountId);
    if (!account || (args?.societyId && account.societyId !== args.societyId)) {
      throw new Error("Account must belong to this society.");
    }
    const accountId = args?.accountId;
    const existing = scopedRows(store?.listRows("financialTransactions", args) ?? financialTransactions, args);
    const seen = new Set(
      existing.filter((t: any) => t.accountId === accountId).map((t: any) => t.externalId),
    );
    const rows = (args?.rows ?? []) as any[];
    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const externalId =
        (typeof row.externalId === "string" && row.externalId.trim()) ||
        `csv:${String(accountId)}:${row.date}:${row.amountCents}:${i}`;
      if (seen.has(externalId)) {
        skipped += 1;
        continue;
      }
      store?.upsertRow("financialTransactions", {
        _id: `static_tx_${externalId.replace(/[^a-zA-Z0-9]+/g, "_")}`,
        societyId: args?.societyId ?? SOCIETY_ID,
        connectionId: account.connectionId,
        accountId,
        externalId,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
        category: row.category,
        counterparty: row.counterparty,
      });
      seen.add(externalId);
      inserted += 1;
    }
    return { inserted, skipped, total: rows.length };
  }
  if (name === "seed:run") {
    void store?.reseed();
    return { societyId: SOCIETY_ID };
  }
  if (name === "seed:reset") {
    void store?.reseed();
    return { ok: true };
  }
  return MUT_NOT_HANDLED;
}

function mutCasesPaperless5(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "paperless:testConnection") {
    return {
      ok: true,
      provider: "demo",
      demo: true,
      baseUrl: "demo://paperless-ngx",
      apiVersion: "demo",
      serverVersion: "demo",
      documentCount: documents.length,
    };
  }
  if (name === "paperless:syncDocument") {
    return {
      taskId: "demo-paperless-task-1002",
      documentId: 1002,
      documentUrl: "demo://paperless/1002",
      demo: true,
      status: "complete",
      tags: ["societyer", "demo"],
    };
  }
  // motionBacklog.* now reads/writes the first-class motions store (the table
  // was retired). A "backlog item" is a motions row with an early status plus
  // the folded-in backlog columns (text/backlogPriority/source/seededKey/notes).
  return MUT_NOT_HANDLED;
}


function mutCasesDocuments7(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "waveCache:sync") {
    return {
      snapshotId: WAVE_CACHE_SNAPSHOT_ID,
      businessName: waveCacheSnapshots[0].businessName,
      resourceCounts: JSON.parse(waveCacheSnapshots[0].resourceCountsJson),
      resourceCount: waveCacheResources.length,
      structureCount: waveCacheStructures.length,
      fetchedAtISO: new Date().toISOString(),
    };
  }
  if (name === "waveCache:healthCheck") {
    return {
      provider: "wave",
      mode: "not_configured",
      ok: true,
      status: "pass",
      checkedAtISO: new Date().toISOString(),
      env: [
        { name: "WAVE_ACCESS_TOKEN", required: true, secret: true, purpose: "Wave GraphQL bearer token", present: false },
        { name: "WAVE_BUSINESS_ID", required: true, secret: false, purpose: "Business selected for live sync", present: false },
        { name: "WAVE_CLIENT_ID", required: false, secret: true, purpose: "OAuth connect link client id; value is never returned in diagnostics", present: false },
        { name: "WAVE_CLIENT_SECRET", required: false, secret: true, purpose: "OAuth connect client secret; value is never returned in diagnostics", present: false },
        { name: "WAVE_GRAPHQL_ENDPOINT", required: false, secret: false, purpose: "GraphQL endpoint override", present: false },
      ],
      business: {
        source: "firstAccessible",
        name: waveCacheSnapshots[0].businessName,
        currencyCode: waveCacheSnapshots[0].currencyCode,
      },
      steps: [
        {
          id: "environment",
          label: "Environment",
          status: "pass",
          message: "Static demo uses fixture Wave data without local secrets.",
        },
        {
          id: "api-probe",
          label: "Wave API probe",
          status: "pass",
          message: "Static demo API probe resolved against fixture data.",
        },
        {
          id: "accounts",
          label: "Accounts probe",
          status: "pass",
          message: "Fixture accounts are available.",
          detail: { accountCount: waveCacheResources.filter((row) => row.resourceType === "account").length },
        },
      ],
    };
  }
  if (name === "paperless:upsertConnection") return PAPERLESS_CONNECTION_ID;
  if (name === "secrets:revealSecret") {
    return { value: "demo-registry-recovery-key", revealedAtISO: new Date().toISOString() };
  }
  return MUT_NOT_HANDLED;
}

function mutCasesSubscriptions8(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "subscriptions:beginCheckout") {
    return {
      url: `demo://checkout/${args?.planId ?? "membership"}`,
      demo: true,
    };
  }
  return MUT_NOT_HANDLED;
}

function mutCasesAssets9(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "documentVersions:recordUploadedVersion") {
    const now = new Date().toISOString();
    const id = `static_documentVersion_${Date.now()}`;
    const existing = store?.listRows("documentVersions", { documentId: args?.documentId }) ?? [];
    store?.transaction(() => {
      for (const row of existing) {
        if (row.isCurrent) store.upsertRow("documentVersions", { ...row, isCurrent: false });
      }
      const versionRow = {
        _id: id,
        _creationTime: Date.now(),
        societyId: args?.societyId ?? SOCIETY_ID,
        documentId: args?.documentId,
        version: args?.version ?? Math.max(0, ...existing.map((row) => Number(row.version) || 0)) + 1,
        storageProvider: args?.storageProvider ?? "demo",
        storageKey: args?.storageKey ?? `demo://document-version/${id}`,
        fileName: args?.fileName ?? "document",
        mimeType: args?.mimeType,
        fileSizeBytes: args?.fileSizeBytes,
        sha256: args?.sha256,
        uploadedByUserId: args?.actingUserId,
        uploadedByName: "Static user",
        uploadedAtISO: now,
        changeNote: args?.changeNote,
        isCurrent: true,
      };
      store.upsertRow("documentVersions", versionRow);
      if (versionRow.storageProvider === "local-filesystem" && versionRow.storageKey) {
        store.upsertAttachment({
          societyId: versionRow.societyId,
          documentId: versionRow.documentId,
          versionId: versionRow._id,
          provider: versionRow.storageProvider,
          storageKey: versionRow.storageKey,
          fileName: versionRow.fileName,
          mimeType: versionRow.mimeType,
          fileSizeBytes: versionRow.fileSizeBytes,
          sha256: versionRow.sha256,
        });
      }
      const document = store.getRow("documents", args?.documentId);
      if (document) {
        store.upsertRow("documents", {
          ...document,
          storageId: undefined,
          fileName: args?.fileName,
          mimeType: args?.mimeType,
          fileSizeBytes: args?.fileSizeBytes,
          updatedAtISO: now,
        });
      }
    });
    return id;
  }
  if (name === "documentVersions:createDemoVersion") {
    return mutationResult("documentVersions:recordUploadedVersion", {
      ...args,
      version: undefined,
      storageProvider: "demo",
      storageKey: `demo://upload/${encodeURIComponent(args?.fileName ?? "document")}`,
    }, store);
  }
  if (name === "documentVersions:getDownloadUrl") {
    const version = store?.getRow("documentVersions", args?.versionId);
    if (!version) return null;
    if (version.storageProvider === "local-filesystem") {
      return `local-file://${encodeURIComponent(version.storageKey)}`;
    }
    if (version.storageProvider === "generated-inline") {
      return version.storageKey;
    }
    if (version.storageProvider === "demo") {
      return `demo://download/${encodeURIComponent(version.storageKey)}`;
    }
    return version.storageKey ? `static://${encodeURIComponent(version.storageKey)}` : null;
  }
  if (name === "documentVersions:getDownloadTarget") {
    const version = store?.getRow("documentVersions", args?.versionId);
    if (!version) return null;
    if (version.storageProvider === "local-filesystem") {
      return {
        kind: "local-filesystem",
        provider: version.storageProvider,
        key: version.storageKey,
        fileName: version.fileName,
        mimeType: version.mimeType,
        fileSizeBytes: version.fileSizeBytes,
      };
    }
    return {
      kind: "url",
      provider: version.storageProvider,
      key: version.storageKey,
      url: mutationResult("documentVersions:getDownloadUrl", args, store),
      fileName: version.fileName,
      mimeType: version.mimeType,
      fileSizeBytes: version.fileSizeBytes,
    };
  }
  return MUT_NOT_HANDLED;
}


const MUT_DISPATCHERS = [
  mutCasesSociety1,
  mutCasesImportSessions2,
  mutCasesAiAgents3,
  mutCasesAccounting4,
  mutCasesPaperless5,
  mutCasesDocuments7,
  mutCasesSubscriptions8,
  mutCasesAssets9,
];

function mutationResult(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  const localResult = store?.mutationResult(name, args);
  if (localResult !== undefined) return localResult;

  for (const dispatch of MUT_DISPATCHERS) {
    const result = dispatch(name, args, store);
    if (result !== MUT_NOT_HANDLED) return result;
  }

    const [moduleName, exportName] = name.split(":");
  // Derived fields that the real Convex handlers compute — inject so the generic
  // CRUD persist below stores them offline too (searchName, totalCents).
  applyYcnDerivedFields(name, args);
  if (exportName && /^(create|update|upsert|issue|setStatus|remove)/.test(exportName)) {
    const tableName = staticMutationTableName(moduleName, exportName);
    if (exportName.startsWith("remove")) {
      const existing = store?.getRow(tableName, args?.id);
      if (tableName === "roleHolders" && existing) {
        staticSnapshotRoleHolderRevision(store, existing, args?.actorUserId);
      }
      store?.removeRow(tableName, args?.id);
      if (tableName === "rightsholdingTransfers" && existing?.societyId) {
        staticSyncRightsHoldings(store, existing.societyId);
      }
      return null;
    }
    const id = args?.id ?? staticLocalId(moduleName, exportName);
    const existing = store?.getRow(tableName, id) ?? {};
    const patch = args?.patch && typeof args.patch === "object" ? args.patch : {};
    const row = {
      ...existing,
      ...args,
      ...patch,
      _id: id,
      societyId: args?.societyId ?? existing.societyId ?? SOCIETY_ID,
      updatedAtISO: new Date().toISOString(),
      createdAtISO: existing.createdAtISO ?? args?.createdAtISO ?? new Date().toISOString(),
    };
    delete row.id;
    delete row.patch;
    if (tableName === "roleHolders") {
      const now = new Date().toISOString();
      if (existing && existing._id) {
        // Edit: append the prior version to the history before patching.
        staticSnapshotRoleHolderRevision(store, existing, args?.actorUserId, now);
        row.enteredAtISO = now;
        row.enteredByUserId = args?.actorUserId;
      } else {
        row.enteredAtISO = row.enteredAtISO ?? now;
        row.enteredByUserId = args?.actorUserId ?? row.enteredByUserId;
      }
      delete row.actorUserId;
    }
    if (tableName === "rightsholdingTransfers") {
      const proposedTransfers = (store?.listRows("rightsholdingTransfers", { societyId: row.societyId }) ?? [])
        .filter((transfer) => String(transfer._id) !== String(id))
        .concat([row])
        .sort(staticRightsholdingTransferChronologicalSort);
      validateLedger(proposedTransfers);
    }
    store?.upsertRow(tableName, row);
    if (tableName === "rightsholdingTransfers") {
      staticSyncRightsHoldings(store, row.societyId);
    }
    return id;
  }
  // Not handled explicitly and not a generic CRUD verb. Intentional offline
  // no-ops (network/AI/email/seed) return null quietly; everything else is a
  // real gap and must be surfaced rather than silently dropped.
  if (STATIC_OFFLINE_NOOP_WRITES.has(name)) return null;
  return reportStaticWriteGap(name);
}






function staticTemplateEngine(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  const dataFields = (store?.listRows("legalTemplateDataFields", args) ?? [])
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  const templates = (store?.listRows("legalTemplates", args) ?? [])
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  const precedents = (store?.listRows("legalPrecedents", args) ?? [])
    .sort((a, b) => String(a.packageName ?? "").localeCompare(String(b.packageName ?? "")));
  const runs = (store?.listRows("legalPrecedentRuns", args) ?? [])
    .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  const generatedDocuments = (store?.listRows("generatedLegalDocuments", args) ?? [])
    .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  const signers = (store?.listRows("legalSigners", args) ?? [])
    .sort((a, b) => String(a.fullName ?? "").localeCompare(String(b.fullName ?? "")));
  return { dataFields, templates, precedents, runs, generatedDocuments, signers };
}

function staticSyncRightsHoldings(store: StaticDemoDexieStore | null | undefined, societyId: string) {
  if (!store) return;
  const existingHoldings = store.listRows("rightsHoldings", { societyId });
  const transfers = store.listRows("rightsholdingTransfers", { societyId }).sort(staticRightsholdingTransferChronologicalSort);
  const nextHoldings = materializeRightsHoldings(transfers);
  const nextByKey = new Map(nextHoldings.map((holding) => [`${holding.rightsClassId}:${holding.holderKey}`, holding]));
  const existingByKey = new Map(existingHoldings.map((holding: any) => [`${holding.rightsClassId}:${holding.holderKey}`, holding]));
  const now = new Date().toISOString();

  store.transaction(() => {
    for (const existing of existingHoldings) {
      const key = `${existing.rightsClassId}:${existing.holderKey}`;
      if (!nextByKey.has(key)) store.removeRow("rightsHoldings", existing._id);
    }
    for (const holding of nextHoldings) {
      const key = `${holding.rightsClassId}:${holding.holderKey}`;
      const existing = existingByKey.get(key);
      store.upsertRow("rightsHoldings", {
        ...existing,
        _id: existing?._id ?? staticLocalId("rightsHoldings", `${holding.rightsClassId}_${holding.holderKey}`),
        _creationTime: existing?._creationTime ?? Date.now(),
        societyId,
        rightsClassId: holding.rightsClassId,
        holderRoleHolderId: holding.holderRoleHolderId,
        holderKey: holding.holderKey,
        quantity: holding.quantity,
        status: holding.status,
        lastTransactionId: holding.lastTransactionId,
        sourceDocumentIds: holding.sourceDocumentIds,
        sourceExternalIds: holding.sourceExternalIds,
        createdAtISO: existing?.createdAtISO ?? now,
        updatedAtISO: now,
      });
    }
  });
}


function staticSnapshotRoleHolderRevision(
  store: StaticDemoDexieStore | null | undefined,
  existing: any,
  actorUserId?: string,
  nowISO: string = new Date().toISOString(),
) {
  if (!store || !existing?._id) return;
  const { revision } = planRoleHolderRevision(existing, nowISO, actorUserId);
  store.upsertRow("roleHolderRevisions", {
    _id: staticLocalId("roleHolderRevisions", String(existing._id)),
    _creationTime: Date.now(),
    societyId: existing.societyId,
    ...revision,
    createdAtISO: nowISO,
  });
}

function staticStoredRoleHolderRevisions(store: StaticDemoDexieStore | null | undefined, where: Record<string, unknown>): StoredRevision[] {
  return (store?.listRows("roleHolderRevisions", where) ?? []).map((row: any) => ({
    roleHolderId: String(row.roleHolderId),
    dataJson: String(row.dataJson ?? "{}"),
    enteredAtISO: String(row.enteredAtISO ?? row.createdAtISO ?? ""),
    enteredByUserId: row.enteredByUserId,
    supersededAtISO: String(row.supersededAtISO ?? ""),
    supersededByUserId: row.supersededByUserId,
  }));
}


function staticLocalId(moduleName: string, exportName = "row") {
  return `static_${moduleName}_${exportName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function staticUniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function staticRightsholdingTransferChronologicalSort(left: any, right: any) {
  const leftDate = String(left.transferDate ?? left.createdAtISO ?? left._creationTime ?? "");
  const rightDate = String(right.transferDate ?? right.createdAtISO ?? right._creationTime ?? "");
  const dateSort = leftDate.localeCompare(rightDate);
  if (dateSort !== 0) return dateSort;
  return Number(left._creationTime ?? 0) - Number(right._creationTime ?? 0);
}

function staticWorkspaceOnboardingTaskSeeds(jurisdictionCode?: string | null) {
  const registry = registryOnboardingCopy(jurisdictionCode);
  return [
    {
      key: "profile",
      title: "Review organization profile",
      description: "Confirm legal name, incorporation number, incorporation date, fiscal year end, jurisdiction, and entity type.",
    },
    {
      key: "registry",
      title: registry.taskTitle,
      description: registry.taskDescription,
    },
    {
      key: "locations",
      title: "Add registered and mailing locations",
      description: "Record registered office, records office, mailing address, and any jurisdiction-specific location evidence.",
    },
    {
      key: "documents",
      title: "Upload governing documents",
      description: "Attach articles, bylaws, constitution, registers, resolutions, or equivalent governing records for this entity.",
    },
    {
      key: "people",
      title: "Add directors, members, shareholders, and access",
      description: "Invite operators and record the people/registers relevant to this workspace type.",
    },
  ];
}

function staticAgentOutput(agent: any, input: string) {
  return [
    `${agent.name} guidance`,
    "",
    `Scope: ${agent.scope}`,
    `Request: ${input}`,
    "",
    ...(agent.workflowModes?.length ? ["Supported workflow modes:", ...agent.workflowModes.map((mode: string) => `- ${mode}`), ""] : []),
    ...(agent.outputContract?.length ? ["Expected output contract:", ...agent.outputContract.map((field: string) => `- ${field}`), ""] : []),
    "Provider status: static demo deterministic stub.",
  ].join("\n");
}

const STATIC_IMPORT_SESSION_TAG = "import-session";
const STATIC_IMPORT_RECORD_TAG = "import-session-record";
const STATIC_IMPORT_SESSION_CATEGORY = "Import Session";
const STATIC_IMPORT_RECORD_CATEGORY = "Import Candidate";



















export type StaticDemoSeed = LocalSeed;

const STATIC_DEMO_SEED: StaticDemoSeed = {
  ...tables,
  societies: [society],
};

class StaticDemoDexieStore {
  private rowsStore: LocalDexieRowStore;

  constructor(seed: StaticDemoSeed, options?: { databaseName?: string }) {
    this.rowsStore = new LocalDexieRowStore(seed, {
      databaseName: options?.databaseName ?? "societyer-static-demo",
      logLabel: "societyer-demo",
    });
  }

  onUpdate(listener: () => void) {
    return this.rowsStore.onUpdate(listener);
  }

  /** The underlying row store — the LocalRowStore the portable ctx.db runs on. */
  get rowStore(): LocalDexieRowStore {
    return this.rowsStore;
  }

  queryResult(name: string, args: StaticArgs) {
    switch (name) {
      case "minutes:get":
        return this.getRow("minutes", args?.id);
    }
    return undefined;
  }

  mutationResult(name: string, args: StaticArgs) {
    return undefined;
  }

  listRows(table: string, args?: StaticArgs) {
    return this.rowsStore.listRows(table, args);
  }

  getRow(table: string, id: string | undefined) {
    return this.rowsStore.getRow(table, id);
  }

  upsertRow(table: string, row: any) {
    return this.rowsStore.upsertRow(table, row);
  }

  removeRow(table: string, id: string | undefined) {
    return this.rowsStore.removeRow(table, id);
  }

  async reseed() {
    await this.rowsStore.reseed();
  }

  async importSnapshot(snapshot: LocalWorkspaceSnapshot) {
    await this.rowsStore.importSnapshot(snapshot);
  }

  transaction<T>(mutate: () => T): T {
    return this.rowsStore.transaction(mutate);
  }

  exportSnapshot() {
    return this.rowsStore.exportSnapshot();
  }

  upsertAttachment(attachment: Parameters<LocalDexieRowStore["upsertAttachment"]>[0]) {
    return this.rowsStore.upsertAttachment(attachment);
  }

  private agendaRowForMeeting(meeting: any) {
    const rows = this.rows("agendas")
      .filter((row) => row.meetingId === meeting._id)
      .sort((a, b) => String(a.createdAtISO).localeCompare(String(b.createdAtISO)));
    return rows[0] ?? null;
  }

  private agendaSummaryForMeeting(meeting: any) {
    const existing = this.agendaRowForMeeting(meeting);
    if (existing) return existing;
    return {
      _id: `static_agenda_${meeting._id}`,
      societyId: meeting.societyId,
      meetingId: meeting._id,
      title: `${meeting.title} agenda`,
      status: "Draft",
      createdAtISO: meeting.scheduledAt,
      updatedAtISO: meeting.updatedAtISO ?? meeting.scheduledAt,
    };
  }

  private agendaForMeeting(meetingId: string | undefined) {
    const meeting = byId(this.rows("meetings"), meetingId);
    if (!meeting) return null;
    const agenda = this.agendaRowForMeeting(meeting);
    if (!agenda) return null;
    const items = this.rows("agendaItems")
      .filter((item) => item.agendaId === agenda._id)
      .sort((a, b) => a.order - b.order);
    if (items.length === 0) return null;
    return { agenda, items };
  }

  private rows(table: string) {
    return this.rowsStore.rows(table);
  }

  private patchRow(table: string, id: string | undefined, patch: Record<string, any>) {
    return this.rowsStore.patchRow(table, id, patch);
  }
}

function staticTableNameForModule(moduleName: string) {
  if (moduleName === "society") return "societies";
  // motionBacklog has been retired into the first-class motions table; the
  // api.motionBacklog.* surface is preserved but reads/writes the motions store.
  if (moduleName === "motionBacklog") return "motions";
  return moduleName;
}

function staticMutationTableName(moduleName: string, exportName: string) {
  if (moduleName === "society") return "societies";
  if (moduleName === "legalOperations" && exportName.includes("RoleHolder")) return "roleHolders";
  if (moduleName === "legalOperations" && exportName.includes("RightsClass")) return "rightsClasses";
  if (moduleName === "legalOperations" && exportName.includes("RightsholdingTransfer")) return "rightsholdingTransfers";
  if (moduleName === "legalOperations" && exportName.includes("TemplateDataField")) return "legalTemplateDataFields";
  if (moduleName === "legalOperations" && exportName.includes("LegalTemplate")) return "legalTemplates";
  if (moduleName === "legalOperations" && exportName.includes("LegalPrecedentRun")) return "legalPrecedentRuns";
  if (moduleName === "legalOperations" && exportName.includes("LegalPrecedent")) return "legalPrecedents";
  if (moduleName === "legalOperations" && exportName.includes("GeneratedLegalDocument")) return "generatedLegalDocuments";
  if (moduleName === "legalOperations" && exportName.includes("LegalSigner")) return "legalSigners";
  if (moduleName === "organizationDetails" && exportName.includes("Address")) return "organizationAddresses";
  if (moduleName === "organizationDetails" && exportName.includes("Registration")) return "organizationRegistrations";
  if (moduleName === "organizationDetails" && exportName.includes("Identifier")) return "organizationIdentifiers";
  if (moduleName === "volunteers" && exportName.includes("Screening")) return "volunteerScreenings";
  if (moduleName === "volunteers" && exportName.includes("Application")) return "volunteerApplications";
  if (moduleName === "fundingSources" && exportName.includes("Event")) return "fundingSourceEvents";
  if (moduleName === "fundingSources") return "fundingSources";
  if (moduleName === "financialHub" && exportName.includes("Budget")) return "budgets";
  if (moduleName === "financialHub" && exportName.includes("OperatingSubscription")) return "operatingSubscriptions";
  if (moduleName === "financialHub" && exportName.includes("Transaction")) return "financialTransactions";
  if (moduleName === "transparency") return "transparency";
  return staticTableNameForModule(moduleName);
}

function staticModelCatalog(provider: string) {
  const models = provider === "openrouter"
    ? [
        staticModel("openai/gpt-4.1-mini", "GPT-4.1 Mini", "openai", 1_000_000, true, false, false, "0.0000004", "0.0000016"),
        staticModel("openai/gpt-4.1", "GPT-4.1", "openai", 1_000_000, true, false, false, "0.000002", "0.000008"),
        staticModel("anthropic/claude-sonnet-4", "Claude Sonnet 4", "anthropic", 200_000, true, true, false, "0.000003", "0.000015"),
        staticModel("google/gemini-2.5-pro", "Gemini 2.5 Pro", "google", 1_000_000, true, true, false, "0.00000125", "0.00001"),
        staticModel("meta-llama/llama-3.1-70b-instruct:free", "Llama 3.1 70B Instruct Free", "meta-llama", 131_000, false, false, true, "0", "0"),
      ]
    : [
        staticModel("gpt-4.1-mini", "GPT-4.1 Mini", "openai", 1_000_000, true, false, false, "0.0000004", "0.0000016"),
        staticModel("gpt-4.1", "GPT-4.1", "openai", 1_000_000, true, false, false, "0.000002", "0.000008"),
        staticModel("gpt-4o-mini", "GPT-4o Mini", "openai", 128_000, true, true, false, "0.00000015", "0.0000006"),
      ];
  return {
    provider,
    cached: true,
    stale: false,
    fetchedAtISO: new Date().toISOString(),
    recommendedIds: models.map((model) => model.id),
    models,
    categories: {
      recommended: models.slice(0, 4),
      fastCheap: models.filter((model) => model.isFree || Number(model.promptPrice) < 0.000001),
      reasoning: models.filter((model) => /gpt-4\.1|claude|gemini/i.test(model.id)),
      coding: models.filter((model) => /gpt|claude|llama/i.test(model.id)),
      vision: models.filter((model) => model.supportsVision),
      free: models.filter((model) => model.isFree),
      tools: models.filter((model) => model.supportsTools),
      all: models,
    },
  };
}

function staticModel(
  id: string,
  name: string,
  provider: string,
  contextLength: number,
  supportsTools: boolean,
  supportsVision: boolean,
  isFree: boolean,
  promptPrice: string,
  completionPrice: string,
) {
  return {
    id,
    name,
    provider,
    contextLength,
    promptPrice,
    completionPrice,
    inputModalities: supportsVision ? ["text", "image"] : ["text"],
    outputModalities: ["text"],
    supportedParameters: supportsTools ? ["tools", "temperature", "max_tokens", "response_format"] : ["temperature", "max_tokens"],
    supportsTools,
    supportsVision,
    supportsStructuredOutputs: supportsTools,
    isFree,
  };
}

export class StaticConvexClient {
  private store: StaticDemoDexieStore;
  private clientUrl: string;
  // Phase 1: the live local runtime. Functions registered here run as the REAL
  // portable handler (shared/functions/*) against the Dexie-backed ctx.db,
  // instead of the hand-written mirror case. See docs/portable-functions-architecture.md.
  private portable: PortableRuntime;
  // Client-level cache for async portable query results. convex/react re-creates
  // a Watch on every render and only subscribes to the committed one, so a result
  // stored in a per-watch closure is thrown away before it reaches the component
  // (sync mirror queries don't hit this because they return data synchronously).
  // Caching by query+args here lets any freshly-created watch read the resolved
  // value synchronously, and `portableListeners` re-renders subscribers on resolve.
  private portableCache = new Map<string, unknown>();
  private portableListeners = new Set<() => void>();
  /** Every portable query ever watched, so store-level updates (hydration,
   *  mutations) can refresh the cache without depending on React's
   *  subscription timing. */
  private portableWatchSpecs = new Map<string, { name: string; args?: StaticArgs }>();

  private emitPortable() {
    for (const listener of this.portableListeners) listener();
  }

  constructor(options?: { databaseName?: string; seed?: StaticDemoSeed; url?: string }) {
    this.store = new StaticDemoDexieStore(options?.seed ?? STATIC_DEMO_SEED, options);
    this.clientUrl = options?.url ?? "static://societyer-demo";
    this.portable = new PortableRuntime({
      db: new LocalStoreDb(this.store.rowStore),
      // Local workspaces have no server-only services wired by default; calling
      // one throws a structured CAPABILITY_UNAVAILABLE rather than silently no-op.
      // buildLocalCapabilities is the seam where native Electron capabilities wire in.
      capabilities: buildLocalCapabilities(),
    }).registerAll(PORTABLE_FUNCTIONS);
    // Client-level refresh: whenever the underlying store changes (a mutation
    // committed, or the async Dexie hydration finished), re-run every watched
    // portable query. Watch-level subscriptions alone race React's effect
    // timing — a hydration that completes between a component's render and its
    // onUpdate subscription would otherwise leave that query stale.
    this.store.onUpdate(() => {
      for (const [cacheKey, spec] of this.portableWatchSpecs) {
        this.recomputePortable(cacheKey, spec.name, spec.args);
      }
    });
    // Seed the Twenty-style record-table metadata for the demo society up front,
    // so RecordTable pages (members, assets, …) render immediately instead of
    // showing the "Metadata not seeded" empty state on first visit. Idempotent.
    void this.ensureRecordTableMetadata();
  }

  /** Fire-and-forget metadata seed for every society in the demo store. */
  private async ensureRecordTableMetadata() {
    try {
      const societies = this.store.listRows("societies") ?? [];
      for (const society of societies as any[]) {
        await this.portable.runMutation("seedRecordTableMetadata:ensureForSociety", {
          societyId: society._id,
          objects: RECORD_TABLE_OBJECTS,
        });
      }
      this.emitPortable();
    } catch (error) {
      console.warn("[societyer-local] metadata auto-seed failed", error);
    }
  }

  get url() {
    return this.clientUrl;
  }

  watchQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    if (this.portable.kind(name) === "query") return this.watchPortableQuery(name, args);
    return {
      onUpdate: (callback: () => void) => this.store.onUpdate(callback),
      localQueryResult: () => mutableQueryResult(name, args, this.store),
      journal: () => undefined,
    };
  }

  /**
   * Async-executor + synchronous-last-result bridge for a portable query.
   *
   * The real async portable handler runs against the Dexie-backed ctx.db on
   * mount and on every store change; its result is cached synchronously so
   * React's useQuery (which reads `localQueryResult()` synchronously) sees it.
   * Until the first async result resolves, the existing synchronous mirror path
   * supplies an instant value, so there is no loading flash for ported queries.
   */
  private recomputePortable(cacheKey: string, name: string, args?: StaticArgs) {
    this.portable
      .runQuery(name, args ?? {})
      .then((next) => {
        const prev = this.portableCache.get(cacheKey);
        if (!this.portableCache.has(cacheKey) || JSON.stringify(next) !== JSON.stringify(prev)) {
          this.portableCache.set(cacheKey, next);
          this.emitPortable();
        }
      })
      .catch((error) => {
        console.warn(`[societyer-local] portable query ${name} failed`, error);
      });
  }

  private watchPortableQuery(name: string, args?: StaticArgs) {
    const store = this.store;
    const cacheKey = `${name}|${JSON.stringify(args ?? {})}`;
    // Registered so the client-level store subscription (see constructor) can
    // refresh EVERY watched query on any store change — including the async
    // Dexie hydration finishing before any React subscriber attached. Without
    // this, a query that first resolved against the pre-hydration fixture
    // cache could stay stale until the next unrelated re-render.
    this.portableWatchSpecs.set(cacheKey, { name, args });

    const recompute = () => this.recomputePortable(cacheKey, name, args);
    recompute();

    return {
      onUpdate: (callback: () => void) => {
        this.portableListeners.add(callback);
        const unsubStore = store.onUpdate(() => recompute());
        // Re-run on (re)subscribe so a watch attached after the initial resolve
        // still refreshes the shared cache; the cached value is read
        // synchronously by localQueryResult regardless of which watch instance
        // convex/react keeps (it re-creates the Watch on every render).
        recompute();
        return () => {
          this.portableListeners.delete(callback);
          unsubStore();
        };
      },
      localQueryResult: () =>
        this.portableCache.has(cacheKey)
          ? this.portableCache.get(cacheKey)
          : portableSyncStub(name, args, store),
      journal: () => undefined,
    };
  }

  watchPaginatedQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    return {
      onUpdate: (callback: () => void) => this.store.onUpdate(callback),
      localQueryResult: () => ({
        results: mutableQueryResult(name, args, this.store) ?? [],
        status: "Exhausted",
        loadMore: () => undefined,
      }),
    };
  }

  query(query: any, args?: StaticArgs) {
    const name = functionName(query);
    if (this.portable.kind(name) === "query") return this.portable.runQuery(name, args ?? {});
    return Promise.resolve(mutableQueryResult(name, args, this.store));
  }

  mutation(mutation: any, args?: StaticArgs) {
    const name = functionName(mutation);
    if (this.portable.kind(name) === "mutation") {
      // The Convex wrapper for this mutation injects RECORD_TABLE_OBJECTS before
      // calling the portable handler; the offline runtime has to do the same or
      // the handler iterates `undefined` ("objects is not iterable").
      const enriched =
        name === "seedRecordTableMetadata:ensureForSociety" && !(args as any)?.objects
          ? { ...(args ?? {}), objects: RECORD_TABLE_OBJECTS }
          : args ?? {};
      return this.portable.runMutation(name, enriched);
    }
    return Promise.resolve(mutationResult(name, args, this.store));
  }

  action(action: any, args?: StaticArgs) {
    return Promise.resolve(mutationResult(functionName(action), args, this.store));
  }

  prewarmQuery() {
    return undefined;
  }

  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: false };
  }

  subscribeToConnectionState() {
    return () => undefined;
  }

  setAuth() {
    return undefined;
  }

  clearAuth() {
    return undefined;
  }

  close() {
    return Promise.resolve();
  }

  get logger() {
    return {
      logVerbose: () => undefined,
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
  }

  reseedStaticDemo() {
    return this.store.reseed();
  }

  exportLocalWorkspaceSnapshot() {
    return this.store.exportSnapshot();
  }

  importLocalWorkspaceSnapshot(snapshot: LocalWorkspaceSnapshot) {
    return this.store.importSnapshot(snapshot);
  }
}

export const staticConvex = new StaticConvexClient();

export function reseedStaticDemoData() {
  return staticConvex.reseedStaticDemo();
}
