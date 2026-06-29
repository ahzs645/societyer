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
  aiToolDrafts,
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

function staticRecordTableSetup(args: StaticArgs) {
  const nameSingular = String(args?.nameSingular ?? "");
  const definition = staticRecordTableDefinitions.get(nameSingular);
  if (!definition) return { object: null, views: [], activeView: null };

  const objectMetadataId = `static_object_${nameSingular}`;
  const viewId = `static_view_${nameSingular}_all`;
  const now = "2026-04-16T16:00:00.000Z";
  const fields = definition.fields.map((field, position) => ({
    _id: `static_field_${nameSingular}_${field.name}`,
    societyId: args?.societyId ?? SOCIETY_ID,
    objectMetadataId,
    name: field.name,
    label: field.label,
    description: field.description,
    icon: field.icon,
    fieldType: field.fieldType,
    configJson: field.config ? JSON.stringify(field.config) : undefined,
    isSystem: field.isSystem ?? false,
    isHidden: field.isHidden ?? false,
    isNullable: true,
    isReadOnly: field.isReadOnly ?? false,
    position,
    createdAtISO: now,
    updatedAtISO: now,
  }));
  const view = {
    _id: viewId,
    societyId: args?.societyId ?? SOCIETY_ID,
    objectMetadataId,
    name: definition.defaultView.name,
    type: "table",
    icon: definition.icon,
    filtersJson: "[]",
    sortsJson: "[]",
    density: "compact",
    isShared: true,
    isSystem: true,
    position: 0,
    createdAtISO: now,
    updatedAtISO: now,
  };
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const columns = definition.defaultView.columns
    .map((column, position) => {
      const field = fieldsByName.get(column.fieldName);
      if (!field) return null;
      return {
        viewField: {
          _id: `static_view_field_${nameSingular}_${column.fieldName}`,
          societyId: args?.societyId ?? SOCIETY_ID,
          viewId,
          fieldMetadataId: field._id,
          position,
          size: column.size ?? 160,
          isVisible: true,
          aggregateOperation: null,
          createdAtISO: now,
          updatedAtISO: now,
        },
        field,
      };
    })
    .filter((column): column is { viewField: any; field: any } => column !== null);

  return {
    object: {
      _id: objectMetadataId,
      societyId: args?.societyId ?? SOCIETY_ID,
      nameSingular,
      namePlural: definition.namePlural,
      labelSingular: definition.labelSingular,
      labelPlural: definition.labelPlural,
      icon: definition.icon,
      iconColor: definition.iconColor,
      labelIdentifierFieldName: definition.labelIdentifierFieldName,
      isSystem: true,
      isActive: true,
      routePath: definition.routePath,
      createdAtISO: now,
      updatedAtISO: now,
      fields,
    },
    views: [
      {
        _id: view._id,
        name: view.name,
        position: view.position,
        isSystem: view.isSystem,
      },
    ],
    activeView: { view, columns },
  };
}


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

function staticCounterpartyStats(externalId?: string) {
  if (!externalId) return {};
  const rows = financialTransactions.filter((row) => row.counterpartyExternalId === externalId);
  if (rows.length === 0) return {};
  return {
    linkedTransactionCount: rows.length,
    linkedTransactionTotalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}

function staticCategoryAccountStats(externalId?: string, label?: string) {
  if (!externalId && !label) return {};
  const normalizedLabel = normalizeStaticCategoryLabel(label);
  const rows = financialTransactions.filter((row) => {
    if (externalId && row.categoryAccountExternalId === externalId) return true;
    return Boolean(normalizedLabel && normalizeStaticCategoryLabel(row.category) === normalizedLabel);
  });
  if (rows.length === 0) return {};
  return {
    linkedCategoryTransactionCount: rows.length,
    linkedCategoryTransactionTotalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}

function staticTrialBalance(seed: StaticDemoSeed | Record<string, any[]> = tables, args?: StaticArgs) {
  const entries = scopedRows(seed.journalEntries ?? [], args).filter((entry) => entry.status === "posted");
  const entryIds = new Set(entries.map((entry) => entry._id));
  const accounts = scopedRows(seed.financialAccounts ?? financialAccounts, args);
  const accountById = new Map(accounts.map((account) => [account._id, account]));
  const totals = new Map<string, { debitCents: number; creditCents: number }>();
  for (const line of scopedRows(seed.journalLines ?? [], args)) {
    if (!entryIds.has(line.journalEntryId)) continue;
    const current = totals.get(line.accountId) ?? { debitCents: 0, creditCents: 0 };
    if (line.side === "debit") current.debitCents += line.amountCents;
    if (line.side === "credit") current.creditCents += line.amountCents;
    totals.set(line.accountId, current);
  }
  return Array.from(totals.entries())
    .map(([accountId, total]) => ({
      account: accountById.get(accountId) ?? null,
      ...total,
      balanceCents: total.debitCents - total.creditCents,
    }))
    .sort((a, b) => String(a.account?.code ?? "").localeCompare(String(b.account?.code ?? "")));
}

function staticGeneralLedger(seed: StaticDemoSeed | Record<string, any[]> = tables, args?: StaticArgs) {
  const entries = scopedRows(seed.journalEntries ?? [], args).filter((entry) => entry.status === "posted");
  const entryById = new Map(entries.map((entry) => [entry._id, entry]));
  const accounts = scopedRows(seed.financialAccounts ?? financialAccounts, args);
  const accountById = new Map(accounts.map((account) => [account._id, account]));
  return scopedRows(seed.journalLines ?? [], args)
    .filter((line) => entryById.has(line.journalEntryId))
    .map((line) => ({ ...line, entry: entryById.get(line.journalEntryId), account: accountById.get(line.accountId) ?? null }))
    .sort((a, b) => `${a.entry.date}:${a.account?.code ?? ""}:${a.lineOrder}`.localeCompare(`${b.entry.date}:${b.account?.code ?? ""}:${b.lineOrder}`));
}

function staticRestrictedFundBalances(seed: StaticDemoSeed | Record<string, any[]> = tables, args?: StaticArgs) {
  const restrictions = scopedRows(seed.fundRestrictions ?? fundRestrictions, args);
  const totals = new Map<string, { debitCents: number; creditCents: number }>();
  for (const line of staticGeneralLedger(seed, args)) {
    if (!line.fundRestrictionId) continue;
    const current = totals.get(line.fundRestrictionId) ?? { debitCents: 0, creditCents: 0 };
    if (line.side === "debit") current.debitCents += line.amountCents;
    if (line.side === "credit") current.creditCents += line.amountCents;
    totals.set(line.fundRestrictionId, current);
  }
  return restrictions
    .map((restriction) => {
      const total = totals.get(restriction._id) ?? { debitCents: 0, creditCents: 0 };
      return {
        ...restriction,
        debitCents: total.debitCents,
        creditCents: total.creditCents,
        balanceCents: total.debitCents - total.creditCents,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function staticAccountingCsv(seed: StaticDemoSeed | Record<string, any[]> = tables, args?: StaticArgs) {
  const kind = args?.kind ?? "trial_balance";
  if (kind === "chart_of_accounts") {
    const rows = [["code", "name", "type", "subtype", "currency", "normal_balance", "external_id"]];
    for (const account of scopedRows(seed.financialAccounts ?? financialAccounts, args).sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")))) {
      rows.push([account.code ?? "", account.name, account.accountType, account.subtype ?? "", account.currency, account.normalBalance ?? "", account.externalId]);
    }
    return { filename: "chart-of-accounts.csv", contentType: "text/csv", csv: staticCsvRows(rows) };
  }
  if (kind === "journal_entries" || kind === "general_ledger") {
    const rows = [["entry_date", "entry_number", "reference", "memo", "status", "source", "account_code", "account_name", "side", "amount_cents", "line_description"]];
    for (const line of staticGeneralLedger(seed, args)) {
      rows.push([line.entry.date, line.entry.entryNumber ?? "", line.entry.reference ?? "", line.entry.memo, line.entry.status, line.entry.source, line.account?.code ?? "", line.account?.name ?? "", line.side, line.amountCents, line.description ?? ""]);
    }
    return { filename: kind === "journal_entries" ? "journal-entries.csv" : "general-ledger.csv", contentType: "text/csv", csv: staticCsvRows(rows) };
  }
  const rows = [["account_code", "account_name", "debit_cents", "credit_cents", "balance_cents"]];
  for (const row of staticTrialBalance(seed, args)) rows.push([row.account?.code ?? "", row.account?.name ?? "", row.debitCents, row.creditCents, row.balanceCents]);
  return { filename: "trial-balance.csv", contentType: "text/csv", csv: staticCsvRows(rows) };
}

function staticBoardAuditorPackage(seed: StaticDemoSeed | Record<string, any[]> = tables, args?: StaticArgs) {
  const ledger = staticGeneralLedger(seed, args);
  const documentIds = new Set<string>();
  for (const line of ledger) for (const id of line.documentIds ?? []) documentIds.add(String(id));
  const attachments = Array.from(documentIds)
    .map((id) => byId(seed.documents ?? tables.documents, id))
    .filter(Boolean)
    .map((document: any) => ({
      documentId: document._id,
      title: document.title,
      category: document.category,
      fileName: document.fileName,
      url: document.url,
    }));
  const trialRows = [["account_code", "account_name", "debit_cents", "credit_cents", "balance_cents"]];
  for (const row of staticTrialBalance(seed, args)) trialRows.push([row.account?.code ?? "", row.account?.name ?? "", row.debitCents, row.creditCents, row.balanceCents]);
  const ledgerRows = [["entry_date", "entry_number", "memo", "account_code", "account_name", "side", "amount_cents", "line_description", "document_ids"]];
  for (const line of ledger) ledgerRows.push([line.entry.date, line.entry.entryNumber ?? "", line.entry.memo, line.account?.code ?? "", line.account?.name ?? "", line.side, line.amountCents, line.description ?? "", (line.documentIds ?? []).join(";")]);
  const reconciliationRows = [["statement_date", "account_id", "statement_balance_cents", "book_balance_cents", "status"]];
  for (const run of scopedRows(seed.reconciliationRuns ?? reconciliationRuns, args)) reconciliationRows.push([run.statementDate, run.financialAccountId, run.statementBalanceCents, run.bookBalanceCents ?? "", run.status]);
  const manifest = {
    packageVersion: 1,
    packageKind: args?.packageKind ?? "board_auditor",
    societyId: args?.societyId ?? SOCIETY_ID,
    societyName: society.name,
    fiscalYear: args?.fiscalYear ?? null,
    generatedAtISO: new Date().toISOString(),
    files: ["manifest.json", "trial-balance.csv", "general-ledger.csv", "reconciliations.csv", "attachments.json"],
    attachmentCount: attachments.length,
  };
  return {
    filename: `societyer-${args?.packageKind ?? "board-auditor"}-${args?.fiscalYear ?? "all"}-package.zip`,
    contentType: "application/zip",
    files: [
      { path: "manifest.json", content: JSON.stringify(manifest, null, 2) },
      { path: "trial-balance.csv", content: staticCsvRows(trialRows) },
      { path: "general-ledger.csv", content: staticCsvRows(ledgerRows) },
      { path: "reconciliations.csv", content: staticCsvRows(reconciliationRows) },
      { path: "attachments.json", content: JSON.stringify(attachments, null, 2) },
    ],
    attachments,
  };
}

function staticAccountingSeed(store?: StaticDemoDexieStore | null, args?: StaticArgs) {
  return {
    financialAccounts: store?.listRows("financialAccounts", args) ?? financialAccounts,
    fundRestrictions: store?.listRows("fundRestrictions", args) ?? fundRestrictions,
    journalEntries: store?.listRows("journalEntries", args) ?? journalEntries,
    journalLines: store?.listRows("journalLines", args) ?? journalLines,
    reconciliationRuns: store?.listRows("reconciliationRuns", args) ?? reconciliationRuns,
    documents: store?.listRows("documents", args) ?? documents,
  };
}



function scopedRows(rows: any[], args: StaticArgs) {
  if (!args?.societyId) return rows;
  return rows.filter((row) => !row.societyId || row.societyId === args.societyId);
}

function dashboardSummary() {
  const activeDirectors = directors.filter((director) => director.status === "Active");
  const activeMembers = members.filter((member) => member.status === "Active");
  const bcResidents = activeDirectors.filter((director) => director.isBCResident).length;
  const overdueFilings = filings.filter((filing) => filing.status !== "Filed" && filing.dueDate < "2026-04-16");
  const upcomingFilings = filings.filter((filing) => filing.status !== "Filed" && filing.dueDate >= "2026-04-16");
  const openDeadlines = deadlines.filter((deadline) => !deadline.done);
  const openConflicts = conflicts.filter((conflict) => !conflict.resolvedAt);

  return {
    society,
    counts: {
      members: activeMembers.length,
      directors: activeDirectors.length,
      bcResidents,
      meetingsThisYear: meetings.filter((meeting) => meeting.scheduledAt.startsWith("2026")).length,
      overdueFilings: overdueFilings.length,
      openDeadlines: openDeadlines.length,
      openConflicts: openConflicts.length,
      committees: committees.filter((committee) => committee.status === "Active").length,
      openGoals: goals.filter((goal) => goal.status !== "Completed").length,
      openTasks: tasks.filter((task) => task.status !== "Done").length,
    },
    board: [...activeDirectors]
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
      .slice(0, 6)
      .map((director: any) => ({
        _id: director._id,
        name: `${director.firstName} ${director.lastName}`.trim(),
        position: director.position,
        termStart: director.termStart ?? "",
        termEnd: director.termEnd,
        isBCResident: director.isBCResident,
      })),
    upcomingMeetings: meetings.filter((meeting) => meeting.status === "Scheduled").slice(0, 3),
    upcomingFilings,
    overdueFilings: overdueFilings.slice(0, 12),
    goals: goals
      .filter((goal) => goal.status !== "Completed")
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
      .slice(0, 4),
    openTasks: tasks
      .filter((task) => task.status !== "Done")
      .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"))
      .slice(0, 6),
    complianceFlags: [
      {
        ruleId: "BC-SOC-DIRECTORS-MIN",
        level: "ok",
        text: "At least three active directors are on record.",
        citationId: "BC-SOC-DIRECTORS-MIN",
        evidenceRequired: ["Active director register"],
        remediationActions: [{ id: "open-directors", label: "Review directors", intent: "navigate", to: "/app/directors" }],
      },
      {
        ruleId: "BC-SOC-DIRECTORS-BC-RESIDENT",
        level: "ok",
        text: "At least one BC-resident director is on record for this non-member-funded society.",
        citationId: "BC-SOC-DIRECTORS-BC-RESIDENT",
        evidenceRequired: ["Active director register", "Director residency field"],
        remediationActions: [{ id: "open-directors", label: "Review directors", intent: "navigate", to: "/app/directors" }],
      },
      {
        ruleId: "BC-SOC-DIRECTOR-CONSENT",
        level: "warn",
        text: "1 director is missing consent evidence.",
        citationId: "BC-SOC-DIRECTOR-CONSENT",
        evidenceRequired: ["Active director register", "Written consent evidence"],
        remediationActions: [
          { id: "open-directors", label: "Update consent", intent: "navigate", to: "/app/directors" },
          { id: "upload-evidence", label: "Upload evidence", intent: "navigate", to: "/app/documents" },
          { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
        ],
      },
      {
        ruleId: "BC-SOC-ANNUAL-REPORT-FILED",
        level: "ok",
        text: "Annual report is filed with confirmation evidence.",
        citationId: "BC-SOC-AGM",
        evidenceRequired: ["Filing record", "Filed date", "Confirmation document", "Audit log"],
        remediationActions: [{ id: "open-filings", label: "Review filing", intent: "navigate", to: "/app/filings" }],
      },
    ],
    evidenceChains: [
      {
        id: "static_filing_ar",
        title: "Annual report proof chain",
        status: "verified",
        summary: "Every link needed to explain why this is complete is present.",
        actionHref: "/app/filings",
        nodes: [
          { label: "Compliance result", value: "Annual report complete", status: "verified" },
          { label: "Filing record", value: "2026 BC annual report", status: "verified", href: "/app/filings" },
          { label: "Filing date", value: "2026-04-14", status: "verified" },
          { label: "Confirmation / evidence", value: "Confirmation BC-AR-2026-0414", status: "verified", href: "/app/documents" },
          { label: "Responsible person", value: "Mina Patel", status: "verified" },
          { label: "Audit log", value: "Mina Patel filed 2026-04-14", status: "verified", href: "/app/audit" },
        ],
      },
    ],
  };
}

function dashboardSummaryFromStore(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  if (!store) return dashboardSummary();
  const societyRow = store.getRow("societies", args?.societyId) ?? society;
  const activeDirectors = store.listRows("directors", args).filter((director: any) => director.status === "Active");
  const activeMembers = store.listRows("members", args).filter((member: any) => member.status === "Active");
  const meetingsRows = store.listRows("meetings", args);
  const filingsRows = store.listRows("filings", args);
  const deadlinesRows = store.listRows("deadlines", args);
  const conflictsRows = store.listRows("conflicts", args);
  const committeesRows = store.listRows("committees", args);
  const goalsRows = store.listRows("goals", args);
  const tasksRows = store.listRows("tasks", args);
  const documentsRows = store.listRows("documents", args);
  const bcResidents = activeDirectors.filter((director: any) => director.isBCResident).length;
  const today = new Date().toISOString().slice(0, 10);
  const overdueFilings = filingsRows.filter((filing: any) => filing.status !== "Filed" && filing.dueDate < today);
  const upcomingFilings = filingsRows.filter((filing: any) => filing.status !== "Filed" && filing.dueDate >= today);
  return {
    ...dashboardSummary(),
    society: societyRow,
    counts: {
      members: activeMembers.length,
      directors: activeDirectors.length,
      bcResidents,
      meetingsThisYear: meetingsRows.filter((meeting: any) => String(meeting.scheduledAt ?? "").startsWith(String(new Date().getFullYear()))).length,
      overdueFilings: overdueFilings.length,
      openDeadlines: deadlinesRows.filter((deadline: any) => !deadline.done).length,
      openConflicts: conflictsRows.filter((conflict: any) => !conflict.resolvedAt).length,
      committees: committeesRows.filter((committee: any) => committee.status !== "Archived").length,
      openGoals: goalsRows.filter((goal: any) => goal.status !== "Completed").length,
      openTasks: tasksRows.filter((task: any) => task.status !== "Done").length,
    },
    board: [...activeDirectors]
      .sort((a: any, b: any) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
      .slice(0, 6)
      .map((director: any) => ({
        _id: director._id,
        name: `${director.firstName} ${director.lastName}`.trim(),
        position: director.position,
        termStart: director.termStart ?? "",
        termEnd: director.termEnd,
        isBCResident: director.isBCResident,
      })),
    upcomingMeetings: meetingsRows.filter((meeting: any) => meeting.status === "Scheduled").slice(0, 3),
    upcomingFilings,
    overdueFilings: overdueFilings.slice(0, 12),
    goals: goalsRows
      .filter((goal: any) => goal.status !== "Completed")
      .sort((a: any, b: any) => String(a.targetDate ?? "9999-12-31").localeCompare(String(b.targetDate ?? "9999-12-31")))
      .slice(0, 4),
    openTasks: tasksRows
      .filter((task: any) => task.status !== "Done")
      .sort((a: any, b: any) => String(a.dueDate ?? "9999-12-31").localeCompare(String(b.dueDate ?? "9999-12-31")))
      .slice(0, 6),
    evidenceChains: documentsRows.slice(0, 3).map((document: any) => ({
      id: document._id,
      title: document.title,
      status: document.flaggedForDeletion ? "attention" : "verified",
      summary: document.fileName ? "Local document metadata is stored in the workspace." : "Document record exists without an attached version.",
      actionHref: `/app/documents/${document._id}`,
      nodes: [
        { label: "Document", value: document.title, status: "verified", href: `/app/documents/${document._id}` },
        { label: "Storage", value: document.fileName ?? "No file attached", status: document.fileName ? "verified" : "attention" },
      ],
    })),
  };
}

function annualCycleSummary(args: StaticArgs) {
  const cycleYear = Number(args?.year ?? new Date().getFullYear());
  const today = "2026-05-10";
  const activeMembers = members.filter((member) => member.status === "Active");
  const votingMembers = activeMembers.filter((member) => member.votingRights);
  const activeDirectors = directors.filter((director: any) => director.status === "Active" && !director.resignedAt);
  const agm = meetings.find((meeting) => meeting.type === "AGM" && inStaticYear(meeting.scheduledAt, cycleYear)) ?? null;
  const agmMinutes = agm ? minutes.find((row) => row.meetingId === agm._id) ?? null : null;
  const annualReport = filings.find((filing) => filing.kind === "AnnualReport" && filingMatchesStaticYear(filing, cycleYear)) ?? null;
  const financial = financials.find((row) => inStaticYear(row.periodEnd, cycleYear) || String(row.fiscalYear).includes(String(cycleYear))) ?? null;
  const annualReportDueDate = agm ? addStaticDays(dateOnlyStatic(agm.scheduledAt), bylawRules.annualReportDueDaysAfterMeeting) : annualReport?.dueDate;
  const noticeWindowClose = agm ? addStaticDays(dateOnlyStatic(agm.scheduledAt), -bylawRules.generalNoticeMinDays) : undefined;
  const officialRecordEvidenceCount = [
    society.constitutionDocId,
    society.bylawsDocId,
    (financial as any)?.statementsDocId,
    annualReport?.receiptDocumentId,
    ...(((agmMinutes as any)?.sourceDocumentIds ?? []) as string[]),
  ].filter(Boolean).length;

  const items = [
    cycleItem("agm-scheduled", "before", "Schedule the AGM", agm ? `${agm.title} is on ${dateOnlyStatic(agm.scheduledAt)}.` : "No AGM is scheduled for this cycle year.", agm ? "complete" : "attention", ["AGM meeting record", "Active bylaw rule set"], agm?.scheduledAt, agm ? `/meetings/${agm._id}` : "/meetings", agm ? "Open AGM" : "Schedule AGM"),
    cycleItem("member-register", "before", "Confirm voting member register", `${votingMembers.length} active voting members found for notice and quorum planning.`, votingMembers.length > 0 || society.memberDataGapDocumented ? "complete" : "attention", ["Active member register", "Voting rights and contact details"], undefined, "/members", "Review members"),
    cycleItem("financial-statements", "before", "Prepare financial statements", financial ? `${financial.fiscalYear} statements end ${financial.periodEnd}; board approval ${financial.approvedByBoardAt ? "recorded" : "not recorded"}.` : "No financial statement record is linked to this cycle yet.", financial?.approvedByBoardAt ? "complete" : financial ? "attention" : "blocked", ["Financial statement document", "Board approval"], agm?.scheduledAt, financial ? `/financials/fy/${encodeURIComponent(financial.fiscalYear)}` : "/financials", financial ? "Open financials" : "Add financials"),
    cycleItem("notice-package", "before", "Send member notice package", agm ? `Notice window closes ${noticeWindowClose}.` : "Schedule the AGM before sending notice.", agm ? "attention" : "blocked", ["Notice delivery log", "Agenda", "Motions"], noticeWindowClose, agm ? `/meetings/${agm._id}/agm` : "/meetings", "Handle notice"),
    cycleItem("attendance-quorum", "during", "Record attendance and quorum", agmMinutes ? `${agmMinutes.attendees?.length ?? 0} attendees; quorum ${agmMinutes.quorumMet ? "met" : "not met"}.` : "Minutes have not captured attendance and quorum yet.", agmMinutes?.quorumMet ? "complete" : agm ? "attention" : "upcoming", ["Attendance list", "Quorum snapshot"], agm?.scheduledAt, agm ? `/meetings/${agm._id}` : "/meetings", "Open meeting"),
    cycleItem("votes-minutes", "during", "Capture votes and minutes", agmMinutes ? `${agmMinutes.motions?.length ?? 0} motions and ${agmMinutes.decisions?.length ?? 0} decisions recorded.` : "No AGM minutes are linked yet.", agmMinutes?.motions?.length || agmMinutes?.decisions?.length ? "complete" : "attention", ["Draft minutes", "Motion outcomes"], undefined, "/minutes", "Open minutes"),
    cycleItem("financials-presented", "during", "Present financial statements", agmMinutes?.agmDetails?.financialStatementsPresented ? "Financial presentation evidence is linked to the AGM." : "Financial presentation has not been confirmed.", agmMinutes?.agmDetails?.financialStatementsPresented ? "complete" : "attention", ["AGM minutes reference", "Financial statements"], agm?.scheduledAt, financial ? `/financials/fy/${encodeURIComponent(financial.fiscalYear)}` : "/financials", "Review presentation"),
    cycleItem("minutes-approval", "after", "Approve and store minutes", agmMinutes?.approvedAt ? `Approved ${agmMinutes.approvedAt}.` : "Minutes are not approved yet.", agmMinutes?.approvedAt ? "complete" : agmMinutes ? "attention" : "upcoming", ["Approved minutes", "Approval evidence"], undefined, "/minutes", "Review minutes"),
    cycleItem("annual-report", "after", "File annual report", annualReport?.status === "Filed" ? `Filed ${annualReport.filedAt ?? "with evidence"}.` : annualReportDueDate ? `Expected due date ${annualReportDueDate}.` : "Schedule the AGM to compute the annual report filing deadline.", annualReport?.status === "Filed" ? "complete" : annualReportDueDate && today > annualReportDueDate ? "blocked" : "attention", ["Annual report filing", "Confirmation number"], annualReport?.dueDate ?? annualReportDueDate, "/filings", annualReport?.status === "Filed" ? "Open filing" : "Prepare filing"),
    cycleItem("minute-book", "after", "Update minute book evidence", `${officialRecordEvidenceCount} core evidence links found for AGM, financials, filings, and governing documents.`, officialRecordEvidenceCount >= 3 ? "complete" : "attention", ["Notice", "Minutes", "Financial statements", "Annual report evidence"], undefined, "/minute-book", "Open minute book"),
    cycleItem("pipa-review", "ongoing", "Review PIPA privacy program", `${society.privacyProgramStatus} privacy program.`, society.privacyPolicyDocId && society.privacyProgramStatus === "Documented" ? "complete" : "attention", ["Privacy policy evidence", "Privacy officer"], undefined, "/privacy", "Open privacy"),
    cycleItem("conflicts", "ongoing", "Refresh conflict disclosures", `${conflicts.filter((conflict) => !conflict.resolvedAt).length} open conflict disclosure.`, conflicts.some((conflict) => !conflict.resolvedAt) ? "attention" : "complete", ["Conflict register", "Resolution notes"], undefined, "/conflicts", "Open conflicts"),
    cycleItem("open-deadlines", "ongoing", "Clear deadlines and recurring obligations", `${deadlines.filter((deadline) => !deadline.done && deadline.dueDate < today).length} overdue deadlines.`, deadlines.some((deadline) => !deadline.done && deadline.dueDate < today) ? "blocked" : "complete", ["Deadline register", "Completion notes"], undefined, "/deadlines", "Open deadlines"),
  ];
  const completed = items.filter((item) => item.status === "complete").length;
  const blocked = items.filter((item) => item.status === "blocked").length;
  const attention = items.filter((item) => item.status === "attention").length;
  const nextItem = items.find((item) => item.status === "blocked") ?? items.find((item) => item.status === "attention") ?? items[0];

  return {
    cycleYear,
    currentStage: annualReport?.status === "Filed" ? "Annual report filed" : agmMinutes ? "Post-AGM work" : agm ? "Planning and notice" : "Not scheduled",
    society,
    agm,
    annualReport,
    annualReportDueDate,
    counts: {
      completed,
      total: items.length,
      blocked,
      attention,
      activeMembers: activeMembers.length,
      votingMembers: votingMembers.length,
      activeDirectors: activeDirectors.length,
      openConflicts: conflicts.filter((conflict) => !conflict.resolvedAt).length,
    },
    nextItem,
    phases: {
      before: items.filter((item) => item.phase === "before"),
      during: items.filter((item) => item.phase === "during"),
      after: items.filter((item) => item.phase === "after"),
      ongoing: items.filter((item) => item.phase === "ongoing"),
    },
    caveats: [
      "Compliance status means evidence readiness in Societyer, not a legal opinion.",
      "Notice, quorum, proxy, electronic voting, and director term rules depend on the active bylaw rule set.",
      "BC annual reports, CRA charity returns, payroll, GST/HST, funder reports, and federal annual returns are separate obligations.",
    ],
  };
}






// Reads that should reflect writes (e.g. CSV-imported rows) prefer the local
// store when one is active, falling back to the module fixtures for non-store
// contexts (SSR, tests). financialTransactions/financialAccounts are seeded into
// the store, so listRows returns the full set including anything imported.
function storeFinancialTransactions(store?: StaticDemoDexieStore | null, args?: StaticArgs) {
  return scopedRows(store?.listRows("financialTransactions", args) ?? financialTransactions, args);
}
function storeFinancialAccounts(store?: StaticDemoDexieStore | null, args?: StaticArgs) {
  return scopedRows(store?.listRows("financialAccounts", args) ?? financialAccounts, args);
}

function financialSummary(store?: StaticDemoDexieStore | null, args?: StaticArgs) {
  const accounts = storeFinancialAccounts(store, args);
  const transactions = storeFinancialTransactions(store, args);
  const budgetRows = scopedRows(store?.listRows("budgets", args) ?? budgets, args);
  return {
    totalBalance: accounts.reduce((sum, account) => sum + account.balanceCents, 0),
    unrestricted: accounts
      .filter((account) => !account.isRestricted)
      .reduce((sum, account) => sum + account.balanceCents, 0),
    restrictedAccounts: accounts
      .filter((account) => account.isRestricted)
      .map((account) => ({
        name: account.name,
        balanceCents: account.balanceCents,
        purpose: account.restrictedPurpose,
      })),
    budgetRows: budgetRows.map((budget) => ({
      ...budget,
      actualCents: transactions
        .filter((transaction) => transaction.category === budget.category)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0),
    })),
    recentTransactions: transactions,
  };
}


function profitAndLoss(args: StaticArgs, store?: StaticDemoDexieStore | null) {
  const from = args?.from ?? "2026-01-01";
  const to = args?.to ?? "2026-12-31";
  const rows = storeFinancialTransactions(store, args).filter((transaction) => transaction.date >= from && transaction.date <= to);
  const incomeByCategoryMap = new Map<string, number>();
  const expenseByCategoryMap = new Map<string, number>();
  let totalIncomeCents = 0;
  let totalExpenseCents = 0;

  for (const transaction of rows) {
    const category = transaction.category ?? "Uncategorized";
    if (transaction.amountCents > 0) {
      incomeByCategoryMap.set(category, (incomeByCategoryMap.get(category) ?? 0) + transaction.amountCents);
      totalIncomeCents += transaction.amountCents;
    } else {
      expenseByCategoryMap.set(category, (expenseByCategoryMap.get(category) ?? 0) + Math.abs(transaction.amountCents));
      totalExpenseCents += Math.abs(transaction.amountCents);
    }
  }

  // Mirror the server shape: arrays of `{ category, cents }` so non-ASCII
  // category names (e.g. Wave's en-dash) survive Convex value validation.
  return {
    from,
    to,
    totalIncomeCents,
    totalExpenseCents,
    netCents: totalIncomeCents - totalExpenseCents,
    incomeByCategory: Array.from(incomeByCategoryMap, ([category, cents]) => ({ category, cents })),
    expenseByCategory: Array.from(expenseByCategoryMap, ([category, cents]) => ({ category, cents })),
    transactionCount: rows.length,
  };
}

function budgetVariance(store?: StaticDemoDexieStore | null, args?: StaticArgs) {
  const transactions = storeFinancialTransactions(store, args);
  return (scopedRows(store?.listRows("budgets", args) ?? budgets, args)).map((budget) => {
    const actualCents = transactions
      .filter((transaction) => transaction.category === budget.category)
      .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);

    return {
      category: budget.category,
      plannedCents: budget.plannedCents,
      actualCents,
      varianceCents: actualCents - budget.plannedCents,
      notes: budget.notes,
    };
  });
}

function restrictedFunds() {
  return [
    {
      grantId: "static_grant",
      title: "Youth resilience grant",
      funder: "Harbour Foundation",
      purpose: "Youth resilience program",
      awardedCents: 1500000,
      inflowCents: 1500000,
      outflowCents: 0,
      balanceCents: 1500000,
      startDate: "2026-04-01",
      endDate: "2027-03-31",
      status: "Active",
    },
  ];
}

function staticAnnualStatement(args: StaticArgs, store?: StaticDemoDexieStore | null) {
  const fiscalYear = args?.fiscalYear;
  const finRows = store?.listRows("financials", args) ?? scopedRows(financials, args);
  const financial =
    finRows
      .filter((row: any) => row.fiscalYear === fiscalYear)
      .sort((a: any, b: any) => String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? "")))[0] ?? null;
  const budgetRows = (store?.listRows("budgets", args) ?? scopedRows(budgets, args)).filter(
    (b: any) => b.fiscalYear === fiscalYear,
  );
  const txns = store?.listRows("financialTransactions", args) ?? scopedRows(financialTransactions, args);

  const incomeByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();
  const actualByCategory = new Map<string, number>();
  for (const txn of txns) {
    const cat = txn.category ?? "Uncategorized";
    const cents = Math.abs(txn.amountCents ?? 0);
    actualByCategory.set(cat, (actualByCategory.get(cat) ?? 0) + cents);
    if ((txn.amountCents ?? 0) > 0) incomeByCategory.set(cat, (incomeByCategory.get(cat) ?? 0) + cents);
    else expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + cents);
  }
  const revenueCents = financial?.revenueCents ?? Array.from(incomeByCategory.values()).reduce((a, b) => a + b, 0);
  const expensesCents = financial?.expensesCents ?? Array.from(expenseByCategory.values()).reduce((a, b) => a + b, 0);

  // Counterparty / grant breakdowns from posted journal lines (mirrors yearEnd.ts).
  const accounts = storeFinancialAccounts(store, args);
  const accountTypeById = new Map<string, string>(accounts.map((a: any) => [String(a._id), a.accountType]));
  const counterpartyName = new Map<string, string>((store?.listRows("accountingCounterparties", args) ?? scopedRows(accountingCounterparties, args)).map((c: any) => [String(c._id), c.name]));
  const grantTitle = new Map<string, string>((store?.listRows("grants", args) ?? scopedRows(tables.grants, args)).map((g: any) => [String(g._id), g.title]));
  const allPosted = (store?.listRows("journalEntries", args) ?? scopedRows(journalEntries, args)).filter((e: any) => e.status === "posted");
  const matchedPosted = allPosted.filter((e: any) => e.fiscalYear === fiscalYear);
  // Mirror the transaction fallback above: if nothing matches the selected FY
  // label (demo entries are tagged by calendar year), use all posted entries.
  const postedEntries = matchedPosted.length ? matchedPosted : allPosted;
  const entryInFy = new Set(postedEntries.map((e: any) => String(e._id)));
  const jLines = store?.listRows("journalLines", args) ?? scopedRows(journalLines, args);
  const byCounterpartyMap = new Map<string, { incomeCents: number; expenseCents: number }>();
  const byGrantMap = new Map<string, { incomeCents: number; expenseCents: number }>();
  const bucket = (map: Map<string, { incomeCents: number; expenseCents: number }>, key: string, type: string, cents: number) => {
    const cur = map.get(key) ?? { incomeCents: 0, expenseCents: 0 };
    if (type === "Income") cur.incomeCents += cents;
    else if (type === "Expense") cur.expenseCents += cents;
    map.set(key, cur);
  };
  for (const line of jLines) {
    if (!entryInFy.has(String(line.journalEntryId))) continue;
    const type = accountTypeById.get(String(line.accountId)) ?? "Other";
    if (line.counterpartyId) bucket(byCounterpartyMap, String(line.counterpartyId), type, line.amountCents);
    if (line.grantId) bucket(byGrantMap, String(line.grantId), type, line.amountCents);
  }

  return {
    fiscalYear,
    financial,
    revenueCents,
    expensesCents,
    surplusCents: revenueCents - expensesCents,
    netAssetsCents: financial?.netAssetsCents ?? null,
    restrictedFundsCents: financial?.restrictedFundsCents ?? null,
    auditStatus: financial?.auditStatus ?? null,
    auditorName: financial?.auditorName ?? null,
    approvedByBoardAt: financial?.approvedByBoardAt ?? null,
    remunerationDisclosures: financial?.remunerationDisclosures ?? [],
    presentedAtMeeting: financial?.presentedAtMeetingId ? byId(meetings, financial.presentedAtMeetingId) : null,
    budgets: budgetRows.map((b: any) => ({
      category: b.category,
      plannedCents: b.plannedCents,
      actualCents: actualByCategory.get(b.category) ?? 0,
      varianceCents: (actualByCategory.get(b.category) ?? 0) - b.plannedCents,
      notes: b.notes,
    })),
    incomeByCategory: Array.from(incomeByCategory, ([category, cents]) => ({ category, cents })),
    expenseByCategory: Array.from(expenseByCategory, ([category, cents]) => ({ category, cents })),
    byCounterparty: Array.from(byCounterpartyMap, ([id, v]) => ({ id, name: counterpartyName.get(id) ?? "Unknown", ...v }))
      .sort((a, b) => (b.incomeCents + b.expenseCents) - (a.incomeCents + a.expenseCents)),
    byGrant: Array.from(byGrantMap, ([id, v]) => ({ id, title: grantTitle.get(id) ?? "Unknown", ...v }))
      .sort((a, b) => (b.incomeCents + b.expenseCents) - (a.incomeCents + a.expenseCents)),
  };
}

function staticRestrictedFundStatement(args: StaticArgs, store?: StaticDemoDexieStore | null) {
  const grantsRows = store?.listRows("grants", args) ?? scopedRows(tables.grants, args);
  const txnsAll = store?.listRows("grantTransactions", args) ?? scopedRows(tables.grantTransactions, args);
  const restricted = grantsRows.filter(
    (g: any) => g.restrictedPurpose && ["Awarded", "Active", "Closed"].includes(g.status),
  );
  const funds = restricted.map((grant: any) => {
    const txns = txnsAll.filter((t: any) => String(t.grantId) === String(grant._id));
    let receiptsCents = 0;
    let disbursementsCents = 0;
    for (const t of txns) {
      if (t.direction === "inflow") receiptsCents += Math.abs(t.amountCents ?? 0);
      else if (t.direction === "outflow") disbursementsCents += Math.abs(t.amountCents ?? 0);
    }
    const openingCents = 0;
    return {
      grantId: grant._id,
      title: grant.title,
      funder: grant.funder,
      purpose: grant.restrictedPurpose,
      awardedCents: grant.amountAwardedCents ?? 0,
      openingCents,
      receiptsCents,
      disbursementsCents,
      closingCents: openingCents + receiptsCents - disbursementsCents,
      status: grant.status,
    };
  });
  const totals = funds.reduce(
    (acc: any, f: any) => ({
      openingCents: acc.openingCents + f.openingCents,
      receiptsCents: acc.receiptsCents + f.receiptsCents,
      disbursementsCents: acc.disbursementsCents + f.disbursementsCents,
      closingCents: acc.closingCents + f.closingCents,
    }),
    { openingCents: 0, receiptsCents: 0, disbursementsCents: 0, closingCents: 0 },
  );
  return { funds, totals };
}

function staticOrgRevenueExpense(args: StaticArgs, store?: StaticDemoDexieStore | null) {
  // Prefer store rows when present, otherwise fall back to the fixtures. The
  // store is seeded with financialTransactions/financialAccounts, but keep the
  // fixture fallback so older persisted workspaces (seeded before those tables
  // were added) still render the statement.
  const storedTxns = store?.listRows("financialTransactions", args);
  const storedAccts = store?.listRows("financialAccounts", args);
  const txns = storedTxns && storedTxns.length ? storedTxns : scopedRows(financialTransactions, args);
  const accts = storedAccts && storedAccts.length ? storedAccts : scopedRows(financialAccounts, args);
  return buildOrgRevenueStatement({
    organizationName: society.name,
    fiscalYearLabel: String(args?.fiscalYear ?? ""),
    transactions: txns as any,
    accounts: accts as any,
  });
}

function staticYearEndReadiness(args: StaticArgs, store?: StaticDemoDexieStore | null) {
  const fiscalYear = args?.fiscalYear;
  const financial = (store?.listRows("financials", args) ?? scopedRows(financials, args)).find(
    (row: any) => row.fiscalYear === fiscalYear,
  ) ?? null;
  const filingsRows = store?.listRows("filings", args) ?? scopedRows(filings, args);
  const isFiled = (pred: (kind: string) => boolean) =>
    filingsRows.some(
      (f: any) => pred(String(f.kind ?? "").toLowerCase()) && /filed|complete|submitted/i.test(String(f.status ?? "")),
    );
  const meetingsRows = store?.listRows("meetings", args) ?? scopedRows(meetings, args);
  const agmHeld = meetingsRows.some(
    (m: any) =>
      /agm|annual/i.test(String(m.type ?? "")) && /held|complete|past|done|true/i.test(String(m.status ?? m.heldAt ?? "")),
  );
  const grantReportsRows = store?.listRows("grantReports", args) ?? scopedRows(tables.grantReports, args);
  const outstanding = grantReportsRows.filter((r: any) => !/submitted|complete/i.test(String(r.status ?? "")));
  const statementsRows = store?.listRows("programStatements", args) ?? scopedRows(tables.programStatements, args);

  const item = (
    key: string,
    label: string,
    ok: boolean,
    detail: string,
    href: string,
    tone: "complete" | "attention" | "upcoming" = ok ? "complete" : "attention",
  ) => ({ key, label, status: tone, ok, detail, href });

  const items = [
    item(
      "financialsApproved",
      "Year-end financial statements approved by the board",
      Boolean(financial?.approvedByBoardAt),
      financial?.approvedByBoardAt ? `Approved ${financial.approvedByBoardAt}.` : "No board approval date recorded.",
      "/app/financials",
    ),
    item(
      "financialsPresented",
      "Financial statements presented to members at the AGM",
      Boolean(financial?.presentedAtMeetingId),
      financial?.presentedAtMeetingId ? "Linked to an AGM meeting record." : "Not yet linked to an AGM.",
      "/app/financials",
    ),
    item(
      "annualReport",
      "BC annual report filed",
      isFiled((k) => k.includes("annual")),
      isFiled((k) => k.includes("annual")) ? "Annual report marked filed." : "Annual report not marked filed.",
      "/app/filings",
    ),
    ...(society?.isCharity
      ? [
          item(
            "t3010",
            "CRA T3010 charity return filed",
            isFiled((k) => k.includes("t3010") || k.includes("charity")),
            isFiled((k) => k.includes("t3010") || k.includes("charity")) ? "T3010 marked filed." : "T3010 not marked filed.",
            "/app/filings",
          ),
        ]
      : []),
    item("agm", "Annual general meeting held", agmHeld, agmHeld ? "An AGM is recorded as held." : "No held AGM found.", "/app/meetings"),
    item(
      "grantReports",
      "Grant reports submitted",
      outstanding.length === 0,
      outstanding.length === 0 ? "All grant reports submitted." : `${outstanding.length} grant report(s) outstanding.`,
      "/app/grants",
      outstanding.length === 0 ? "complete" : "attention",
    ),
    item(
      "programStatements",
      "Program actuals & budget statements prepared",
      statementsRows.length > 0,
      statementsRows.length > 0 ? `${statementsRows.length} program statement(s) prepared.` : "No program statements prepared yet.",
      "/app/financials/year-end",
      statementsRows.length > 0 ? "complete" : "upcoming",
    ),
  ];
  const completed = items.filter((i) => i.ok).length;
  return { fiscalYear, items, completed, total: items.length, ready: items.every((i) => i.ok) };
}

function staticDocumentReviewQueues() {
  const taskCounts = new Map<string, number>();
  for (const task of tasks.filter((task) => task.status !== "Done" && task.documentId)) {
    taskCounts.set(String(task.documentId), (taskCounts.get(String(task.documentId)) ?? 0) + 1);
  }
  const commentCounts = new Map<string, number>();
  for (const comment of documentComments.filter((comment) => comment.status !== "resolved")) {
    commentCounts.set(String(comment.documentId), (commentCounts.get(String(comment.documentId)) ?? 0) + 1);
  }
  const materialDocIds = new Set(meetingMaterials.map((row) => String(row.documentId)));
  const annotate = (document: any) => ({
    ...document,
    openTaskCount: taskCounts.get(String(document._id)) ?? 0,
    openCommentCount: commentCounts.get(String(document._id)) ?? 0,
    signatureCount: 0,
    linkedToMeetingPackage: materialDocIds.has(String(document._id)) || !!document.meetingId,
  });
  const annotated = documents.map(annotate);
  return {
    recent: annotated
      .filter((document) => document.lastOpenedAtISO || document.createdAtISO)
      .sort((a, b) => String(b.lastOpenedAtISO ?? b.createdAtISO).localeCompare(String(a.lastOpenedAtISO ?? a.createdAtISO)))
      .slice(0, 8),
    actionRequired: annotated
      .filter((document) => document.reviewStatus === "needs_signature" || document.openCommentCount > 0 || document.openTaskCount > 0)
      .slice(0, 8),
    workInProgress: annotated
      .filter((document) => document.reviewStatus === "in_review" || document.linkedToMeetingPackage || document.openCommentCount > 0)
      .slice(0, 8),
    counts: {
      documents: annotated.length,
      recent: annotated.length,
      actionRequired: annotated.filter((document) => document.reviewStatus === "needs_signature" || document.openCommentCount > 0 || document.openTaskCount > 0).length,
      workInProgress: annotated.filter((document) => document.reviewStatus === "in_review" || document.linkedToMeetingPackage || document.openCommentCount > 0).length,
    },
  };
}

function staticDocumentReviewQueuesFromStore(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  if (!store) return staticDocumentReviewQueues();
  const rows = store.listRows("documents", args).filter((document: any) => !staticIsImportSession(document) && !staticIsImportRecord(document));
  const taskCounts = new Map<string, number>();
  for (const task of store.listRows("tasks", args).filter((task: any) => task.status !== "Done" && task.documentId)) {
    taskCounts.set(String(task.documentId), (taskCounts.get(String(task.documentId)) ?? 0) + 1);
  }
  const commentCounts = new Map<string, number>();
  for (const comment of store.listRows("documentComments", args).filter((comment: any) => comment.status !== "resolved")) {
    commentCounts.set(String(comment.documentId), (commentCounts.get(String(comment.documentId)) ?? 0) + 1);
  }
  const materialDocIds = new Set(store.listRows("meetingMaterials", args).map((row: any) => String(row.documentId)));
  const annotated = rows.map((document: any) => ({
    ...document,
    openTaskCount: taskCounts.get(String(document._id)) ?? 0,
    openCommentCount: commentCounts.get(String(document._id)) ?? 0,
    signatureCount: 0,
    linkedToMeetingPackage: materialDocIds.has(String(document._id)) || !!document.meetingId,
  }));
  const actionRequired = annotated.filter((document: any) => document.reviewStatus === "needs_signature" || document.openCommentCount > 0 || document.openTaskCount > 0);
  const workInProgress = annotated.filter((document: any) => document.reviewStatus === "in_review" || document.linkedToMeetingPackage || document.openCommentCount > 0);
  return {
    recent: annotated
      .filter((document: any) => document.lastOpenedAtISO || document.createdAtISO)
      .sort((a: any, b: any) => String(b.lastOpenedAtISO ?? b.createdAtISO).localeCompare(String(a.lastOpenedAtISO ?? a.createdAtISO)))
      .slice(0, 8),
    actionRequired: actionRequired.slice(0, 8),
    workInProgress: workInProgress.slice(0, 8),
    counts: {
      documents: annotated.length,
      recent: annotated.length,
      actionRequired: actionRequired.length,
      workInProgress: workInProgress.length,
    },
  };
}

function staticMeetingPackage(args: StaticArgs) {
  const meeting = byId(meetings, args?.meetingId) ?? meetings[0];
  const materials = meetingMaterials
    .filter((material) => material.meetingId === meeting._id)
    .map((material) => ({ ...material, document: byId(documents, material.documentId) }))
    .sort((a, b) => a.order - b.order);
  const agendaTitles = staticAgendaTitlesForMeeting(meeting._id);
  return {
    meeting,
    minutes: minutes.find((row) => row.meetingId === meeting._id) ?? null,
    agenda: agendaTitles,
    materials,
    tasks: tasks.filter((task) => task.meetingId === meeting._id),
    counts: {
      agendaItems: agendaTitles.length,
      materials: materials.length,
      requiredMaterials: materials.filter((material) => material.requiredForMeeting).length,
      openTasks: tasks.filter((task) => task.meetingId === meeting._id && task.status !== "Done").length,
    },
  };
}

function staticLibraryOverview() {
  const referenceDocuments = documents
    .filter((document) =>
      document.librarySection ||
      ["Policy", "Bylaws", "Constitution"].includes(document.category) ||
      document.tags?.includes("library") ||
      meetingMaterials.some((material) => material.documentId === document._id),
    )
    .sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)));
  const sectionsMap = new Map<string, any[]>();
  for (const document of referenceDocuments) {
    const section = document.librarySection ?? (document.category === "Policy" ? "policy" : document.category === "FinancialStatement" ? "finance" : "governance");
    if (!sectionsMap.has(section)) sectionsMap.set(section, []);
    sectionsMap.get(section)!.push(document);
  }
  const meetingPackets = Array.from(new Set(meetingMaterials.map((material) => material.meetingId)))
    .map((meetingId) => {
      const meeting = byId(meetings, meetingId);
      const materials = meetingMaterials
        .filter((material) => material.meetingId === meetingId)
        .map((material) => ({ ...material, document: byId(documents, material.documentId) }))
        .filter((material) => material.document);
      return { meeting, materials, requiredCount: materials.filter((material) => material.requiredForMeeting).length };
    })
    .filter((packet) => packet.meeting);
  return {
    referenceDocuments,
    meetingPackets,
    sections: Array.from(sectionsMap, ([section, documents]) => ({ section, documents })),
    counts: {
      referenceDocuments: referenceDocuments.length,
      meetingPackets: meetingPackets.length,
      meetingMaterials: meetingMaterials.length,
    },
  };
}

// Read the ordered agenda items for a meeting from the static agenda fixtures
// (agendas + agendaItems). The relational store is the single source of truth.
function staticAgendaItemsForMeeting(meetingId: string | undefined) {
  if (!meetingId) return [] as Array<{ title: string; depth: 0 | 1; type?: string; presenter?: string; details?: string; motionText?: string }>;
  const agenda = agendas
    .filter((row) => row.meetingId === meetingId)
    .sort((a, b) => String(a.createdAtISO).localeCompare(String(b.createdAtISO)))[0];
  if (!agenda) return [];
  return agendaItems
    .filter((item) => item.agendaId === agenda._id)
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      title: String(item.title ?? "").trim(),
      depth: (Number(item.depth) === 1 ? 1 : 0) as 0 | 1,
      type: (item as any).type,
      presenter: (item as any).presenter,
      details: (item as any).details,
      motionText: (item as any).motionText,
    }))
    .filter((entry) => entry.title);
}

function staticAgendaTitlesForMeeting(meetingId: string | undefined) {
  return staticAgendaItemsForMeeting(meetingId).map((entry) => entry.title);
}


function staticFundingSourcesList() {
  return fundingSources.map((source) => {
    const events = fundingSourceEvents
      .filter((event) => event.sourceId === source._id)
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
    const receivedFromEventsCents = events
      .filter((event) => event.kind === "Received")
      .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    const committedFromEventsCents = events
      .filter((event) => event.kind === "Pledged" || event.kind === "Agreement")
      .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    return {
      ...source,
      events,
      eventCount: events.length,
      lastEventDate: events[0]?.eventDate,
      committedTotalCents: (source.committedCents ?? 0) + committedFromEventsCents,
      receivedTotalCents: (source.receivedToDateCents ?? 0) + receivedFromEventsCents,
    };
  });
}

function staticFundingRollup(args: StaticArgs) {
  const from = args?.from;
  const to = args?.to;
  const inRange = (date?: string) => {
    if (!date) return true;
    const day = date.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  };
  const groups = new Map<string, any>();
  const group = (name: string, sourceType: string) => {
    const key = `${sourceType}:${name}`.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name,
        sourceType,
        plannedCents: 0,
        committedCents: 0,
        receivedCents: 0,
        sourceCount: 0,
        observedFrom: [],
        restrictedPurposes: [],
        collectionAgents: [],
        memberDisclosureLevels: [],
        collectionFrequencies: [],
        collectionScheduleNotes: [],
      });
    }
    return groups.get(key);
  };
  const observe = (row: any, label: string) => {
    if (!row.observedFrom.includes(label)) row.observedFrom.push(label);
  };
  const activity = (row: any, date?: string) => {
    if (date && (!row.lastActivityDate || date > row.lastActivityDate)) row.lastActivityDate = date;
  };

  for (const source of fundingSources) {
    const row = group(source.name, source.sourceType);
    row.sourceCount += 1;
    row.plannedCents += source.expectedAnnualCents ?? 0;
    row.committedCents += source.committedCents ?? 0;
    row.receivedCents += source.receivedToDateCents ?? 0;
    if (source.restrictedPurpose && !row.restrictedPurposes.includes(source.restrictedPurpose)) {
      row.restrictedPurposes.push(source.restrictedPurpose);
    }
    if (source.collectionAgentName && !row.collectionAgents.includes(source.collectionAgentName)) {
      row.collectionAgents.push(source.collectionAgentName);
    }
    if (source.memberDisclosureLevel && !row.memberDisclosureLevels.includes(source.memberDisclosureLevel)) {
      row.memberDisclosureLevels.push(source.memberDisclosureLevel);
    }
    if (source.collectionFrequency && !row.collectionFrequencies.includes(source.collectionFrequency)) {
      row.collectionFrequencies.push(source.collectionFrequency);
    }
    if (source.collectionScheduleNotes && !row.collectionScheduleNotes.includes(source.collectionScheduleNotes)) {
      row.collectionScheduleNotes.push(source.collectionScheduleNotes);
    }
    if (source.nextExpectedCollectionDate && (!row.nextExpectedCollectionDate || source.nextExpectedCollectionDate < row.nextExpectedCollectionDate)) {
      row.nextExpectedCollectionDate = source.nextExpectedCollectionDate;
    }
    if (source.estimatedMemberCount != null) {
      row.estimatedMemberCount = (row.estimatedMemberCount ?? 0) + source.estimatedMemberCount;
    }
    observe(row, "register");
    activity(row, source.startDate);
  }
  for (const event of fundingSourceEvents.filter((event) => inRange(event.eventDate))) {
    const source = fundingSources.find((candidate) => candidate._id === event.sourceId);
    if (!source) continue;
    const row = group(source.name, source.sourceType);
    if (event.kind === "Received") row.receivedCents += event.amountCents ?? 0;
    if (event.kind === "Pledged" || event.kind === "Agreement") row.committedCents += event.amountCents ?? 0;
    if (event.attributionStatus && !row.memberDisclosureLevels.includes(event.attributionStatus)) {
      row.memberDisclosureLevels.push(event.attributionStatus);
    }
    if (event.memberCount != null) {
      row.estimatedMemberCount = (row.estimatedMemberCount ?? 0) + event.memberCount;
    }
    observe(row, "funding events");
    activity(row, event.eventDate);
  }
  for (const receipt of tables.receipts.filter((receipt) => inRange(receipt.issuedAtISO))) {
    const row = group(receipt.donorName, "Donor");
    row.receivedCents += receipt.amountCents ?? 0;
    observe(row, "receipts");
    activity(row, receipt.issuedAtISO);
  }
  for (const subscription of memberSubscriptions.filter((subscription) => subscription.status !== "canceled")) {
    const plan = subscriptionPlans.find((plan) => plan._id === subscription.planId);
    const row = group(subscription.fullName, "Member dues");
    if (subscription.status === "active" && plan) {
      row.plannedCents += plan.interval === "month" ? plan.priceCents * 12 : plan.interval === "semester" ? plan.priceCents * 2 : plan.priceCents;
    }
    if (inRange(subscription.lastPaymentAtISO)) row.receivedCents += subscription.lastPaymentCents ?? 0;
    observe(row, "member billing");
    activity(row, subscription.lastPaymentAtISO ?? subscription.startedAtISO);
  }

  const rows = Array.from(groups.values()).sort((a, b) => b.receivedCents - a.receivedCents || a.name.localeCompare(b.name));
  return {
    rows,
    totalPlannedCents: rows.reduce((sum, row) => sum + row.plannedCents, 0),
    totalCommittedCents: rows.reduce((sum, row) => sum + row.committedCents, 0),
    totalReceivedCents: rows.reduce((sum, row) => sum + row.receivedCents, 0),
  };
}

function grantsSummary() {
  return {
    total: tables.grants.length,
    pipeline: 1,
    active: 1,
    awardedCents: 1500000,
    linkedRestrictedBalanceCents: 2750000,
    pendingApplications: 1,
    ledgerSpendCents: 0,
    overdueReports: 0,
    dueSoonReports: 1,
  };
}

function staticGrantSourceLibrary() {
  return BUILT_IN_GRANT_SOURCES.map((librarySource) => {
    const source = tables.grantSources.find((row) => row.libraryKey === librarySource.libraryKey);
    const profile = tables.grantSourceProfiles.find((row) => row.libraryKey === librarySource.libraryKey);
    return {
      ...(source ?? {}),
      ...librarySource,
      builtIn: true,
      profile: profile ?? BUILT_IN_GRANT_SOURCE_PROFILES.find((row) => row.libraryKey === librarySource.libraryKey),
    };
  });
}

function electionBundle(args: StaticArgs) {
  const election = byId(elections, args?.id) ?? elections[0];
  const questions = electionQuestions.filter((row) => row.electionId === election._id);
  const eligible = electionEligibleVoters.filter((row) => row.electionId === election._id);
  const ballots = tables.electionBallots.filter((row) => row.electionId === election._id);
  const audit = electionAuditEvents.filter((row) => row.electionId === election._id);

  return {
    election,
    questions,
    eligible,
    ballots,
    ballotCount: ballots.length,
    audit,
    canSeeSensitive: true,
  };
}

function mineElections(args: StaticArgs) {
  if (!args?.userId) return [];
  const user = byId(users, args.userId);
  if (!user?.memberId) return [];

  return electionEligibleVoters
    .filter((row) => row.memberId === user.memberId)
    .map((eligibility) => ({
      election: byId(elections, eligibility.electionId),
      eligibility,
    }))
    .filter((row) => row.election?.societyId === args.societyId);
}

function electionTally(args: StaticArgs) {
  const electionId = args?.electionId ?? ELECTION_ID;
  return electionQuestions
    .filter((question) => question.electionId === electionId)
    .map((question) => ({
      questionId: question._id,
      title: question.title,
      totals: question.options.map((option) => ({
        id: option.id,
        label: option.label,
        votes: 0,
      })),
    }));
}

function publicCenter(args?: StaticArgs) {
  if (!args?.slug || args.slug !== society.publicSlug || !society.publicTransparencyEnabled) {
    return null;
  }
  return {
    society: {
      ...society,
      volunteerApplyPath:
        society.publicVolunteerIntakeEnabled && society.publicSlug
          ? `/public/${society.publicSlug}/volunteer-apply`
          : undefined,
      grantApplyPath:
        society.publicGrantIntakeEnabled &&
        society.publicSlug &&
        tables.grants.some((grant) => grant.allowPublicApplications)
          ? `/public/${society.publicSlug}/grant-apply`
          : undefined,
    },
    directors: society.publicShowBoard
      ? directors
          .filter((director) => director.status === "Active")
          .map((director) => ({
            _id: director._id,
            name: `${director.firstName} ${director.lastName}`,
            position: director.position,
          }))
      : [],
    publications: tables.transparency.filter((row) => {
      if (row.status !== "Published") return false;
      if (!society.publicShowBylaws && row.category === "Bylaws") return false;
      if (!society.publicShowFinancials && ["AnnualReport", "FinancialSummary"].includes(row.category)) return false;
      return true;
    }),
    documents: documents.filter((document) => document.public),
  };
}

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

function staticExportRows(table: string, args?: StaticArgs) {
  if (!table) return [];
  if (table === "societies") return [society].filter((row) => !args?.societyId || row._id === args.societyId);
  const key = STATIC_EXPORT_ALIASES[table] ?? table;
  return scopedRows(tables[key] ?? [], args).map((row: any) => staticSanitizeExportRow(row));
}

function staticExportSummaries(args?: StaticArgs) {
  return STATIC_EXPORT_TABLES.map((name) => ({
    name,
    rowCount: staticExportRows(name, args).length,
    exportable: true,
  }));
}

function staticExportValidation(args?: StaticArgs) {
  const summaries = staticExportSummaries(args);
  const totalRows = summaries.reduce((sum, table) => sum + table.rowCount, 0);
  return {
    ok: true,
    version: 2,
    tableCount: STATIC_EXPORT_TABLES.length,
    nonEmptyTableCount: summaries.filter((table) => table.rowCount > 0).length,
    totalRows,
    issues: [],
    tables: summaries,
    generatedAtISO: new Date().toISOString(),
    societyId: args?.societyId ?? SOCIETY_ID,
    societyName: society.name,
  };
}

function staticPipaPolicyDraft() {
  const today = new Date().toISOString().slice(0, 10);
  return `# ${society.name} Privacy Policy

Draft created: ${today}

Status: Draft - not adopted until approved by the authorized board, executive, or officer.

This draft is a Societyer starter template based on BC PIPA guidance. It is not legal advice and it is not an official BC OIPC template. Replace bracketed text and remove options that do not apply before adoption.

## 1. Organization

${society.name} collects, uses, discloses, stores, and disposes of personal information in accordance with British Columbia's Personal Information Protection Act (PIPA) and other applicable laws.

- Legal name: ${society.name}
- Incorporation number: ${society.incorporationNumber}
- Mailing address: ${society.mailingAddress}
- General contact: ${society.publicContactEmail}

## 2. Privacy Officer

The privacy officer is responsible for privacy questions, access and correction requests, privacy complaints, and maintaining this policy.

- Privacy officer: ${society.privacyOfficerName}
- Email: ${society.privacyOfficerEmail}
- Mailing address: ${society.mailingAddress}

## 3. Member Records and Institution-Held Data

Current member-data access status in Societyer: ${society.memberDataAccessStatus}.

Tailor this section to the actual member list, university data-sharing limits, and evidence stored in Societyer before adoption.

## 4. Complaint Process

Privacy questions, access requests, correction requests, and complaints should be sent to the privacy officer. The organization will review the request, gather relevant information, respond within the timelines required by law, and keep a record of the outcome.

## 5. Adoption

Policy adopted by: [board / executive / authorized officer]

Adoption date: [YYYY-MM-DD]

Last review date: ${today}

Next review date: [YYYY-MM-DD]
`;
}

function staticExportWorkspace(args?: StaticArgs) {
  const summaries = staticExportSummaries(args);
  const tableRows = Object.fromEntries(
    STATIC_EXPORT_TABLES.map((table) => [table, staticExportRows(table, args)]),
  );
  return {
    kind: "societyer.workspaceExport",
    version: 2,
    generatedAtISO: new Date().toISOString(),
    society: staticSanitizeExportRow(society),
    manifest: {
      societyId: args?.societyId ?? SOCIETY_ID,
      societyName: society.name,
      tableCount: STATIC_EXPORT_TABLES.length,
      exportedTableCount: STATIC_EXPORT_TABLES.length,
      totalRows: summaries.reduce((sum, table) => sum + table.rowCount, 0),
      redactedFields: ["secretEncrypted", "tokenHash", "storageId"],
      binaryFilesIncluded: false,
      tables: summaries,
    },
    validation: staticExportValidation(args),
    tables: tableRows,
  };
}

function staticSanitizeExportRow(row: any) {
  const copy = { ...row };
  for (const field of ["secretEncrypted", "tokenHash", "storageId"]) {
    if (field in copy) copy[field] = "[redacted]";
  }
  return copy;
}

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
    case "assets:bundle": {
      const asset = store?.getRow("assets", args?.id) ?? byId(tables.assets, args?.id);
      if (!asset) return null;
      return {
        asset,
        events: (store?.listRows("assetEvents", { societyId: asset.societyId }) ?? tables.assetEvents)
          .filter((row: any) => row.assetId === asset._id)
          .sort((a: any, b: any) => b.happenedAtISO.localeCompare(a.happenedAtISO)),
        maintenance: (store?.listRows("assetMaintenance", { societyId: asset.societyId }) ?? tables.assetMaintenance)
          .filter((row: any) => row.assetId === asset._id),
        receiptLinks: (store?.listRows("assetReceiptLinks", { societyId: asset.societyId }) ?? tables.assetReceiptLinks)
          .filter((row: any) => row.assetId === asset._id),
      };
    }
    case "inventoryHub:items": {
      const rows = store?.listRows("inventoryItems", args) ?? scopedRows(tables.inventoryItems, args);
      return args?.itemType ? rows.filter((row: any) => row.itemType === args.itemType) : rows;
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

function queryCasesFinancialHub6(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  return QUERY_NOT_HANDLED;
}

function queryCasesMembers7(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "meetingMaterials:packageForMeeting":
      return staticMeetingPackage(args);
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesTransparency8(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "transparency:publicCenter":
      return publicCenter(args);
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
  queryCasesFinancialHub6,
  queryCasesMembers7,
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
  return [];
}


function mutableQueryResult(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null) {
  return store?.queryResult(name, args) ?? queryResult(name, args, store);
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
      aiToolDrafts.unshift(draft);
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

function mutCasesMeetings6(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
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

function mutCasesDocuments10(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  return MUT_NOT_HANDLED;
}

const MUT_DISPATCHERS = [
  mutCasesSociety1,
  mutCasesImportSessions2,
  mutCasesAiAgents3,
  mutCasesAccounting4,
  mutCasesPaperless5,
  mutCasesMeetings6,
  mutCasesDocuments7,
  mutCasesSubscriptions8,
  mutCasesAssets9,
  mutCasesDocuments10,
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

function staticNormalizeSignerName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function staticFindSignatureProfile(store: StaticDemoDexieStore | null | undefined, args: StaticArgs & { normalizedSignerName?: string }) {
  const societyId = args?.societyId ?? SOCIETY_ID;
  const normalizedSignerName = args?.normalizedSignerName ?? staticNormalizeSignerName(args?.signerName);
  const profiles = store?.listRows("signatureProfiles", { societyId }) ?? [];
  return (
    profiles.find((profile: any) => args?.userId && profile.userId === args.userId) ??
    profiles.find((profile: any) => args?.directorId && profile.directorId === args.directorId) ??
    profiles.find((profile: any) => args?.memberId && profile.memberId === args.memberId) ??
    profiles.find((profile: any) => profile.normalizedSignerName === normalizedSignerName) ??
    null
  );
}

function staticUpsertSignatureProfile(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  const signerName = String(args?.signerName ?? args?.typedName ?? "").trim();
  if (!signerName) throw new Error("A signer name is required.");

  const now = new Date().toISOString();
  const normalizedSignerName = staticNormalizeSignerName(signerName);
  const existing = staticFindSignatureProfile(store, { ...args, normalizedSignerName });
  const id = args?.id ?? existing?._id ?? staticLocalId("signatureProfile", "profile");
  store?.upsertRow("signatureProfiles", {
    ...existing,
    _id: id,
    _creationTime: existing?._creationTime ?? Date.now(),
    societyId: args?.societyId ?? existing?.societyId ?? SOCIETY_ID,
    userId: args?.userId,
    directorId: args?.directorId,
    memberId: args?.memberId,
    signerName,
    normalizedSignerName,
    signerRole: args?.signerRole,
    method: args?.method ?? (args?.imageDataUrl ? "drawn" : "typed"),
    typedName: args?.typedName,
    imageDataUrl: args?.imageDataUrl,
    imageMimeType: args?.imageMimeType,
    createdAtISO: existing?.createdAtISO ?? now,
    updatedAtISO: now,
    createdByUserId: existing?.createdByUserId ?? args?.actingUserId,
    updatedByUserId: args?.actingUserId,
  });
  return id;
}

function staticSign(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  const signerName = String(args?.signerName ?? args?.typedName ?? "").trim();
  if (!signerName) throw new Error("A signer name is required.");

  let signatureProfileId = args?.signatureProfileId;
  if (args?.saveToProfile) {
    signatureProfileId = staticUpsertSignatureProfile(store, args);
  }

  const profile = signatureProfileId ? store?.getRow("signatureProfiles", signatureProfileId) : null;
  const now = new Date().toISOString();
  const id = args?.id ?? staticLocalId("signature", "sign");
  store?.upsertRow("signatures", {
    _id: id,
    _creationTime: Date.now(),
    societyId: args?.societyId ?? profile?.societyId ?? SOCIETY_ID,
    entityType: args?.entityType,
    entityId: args?.entityId,
    userId: args?.userId ?? profile?.userId,
    directorId: args?.directorId ?? profile?.directorId,
    memberId: args?.memberId ?? profile?.memberId,
    signatureProfileId,
    signerName,
    signerRole: args?.signerRole ?? profile?.signerRole,
    method: args?.method ?? profile?.method ?? "typed",
    typedName: args?.typedName ?? profile?.typedName ?? signerName,
    imageDataUrl: args?.imageDataUrl ?? profile?.imageDataUrl,
    imageMimeType: args?.imageMimeType ?? profile?.imageMimeType,
    signedAtISO: now,
    demo: args?.demo ?? true,
  });
  return { signatureId: id, signatureProfileId };
}

function staticUpsertComplianceDecision(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  const nowISO = new Date().toISOString();
  const societyId = args?.societyId ?? SOCIETY_ID;
  const ruleId = String(args?.ruleId ?? "");
  const existing = (store?.listRows("complianceRemediations", { societyId }) ?? [])
    .find((row) => row.ruleId === ruleId);
  const remediationId = existing?._id ?? `static_compliance_remediation_${Date.now()}`;
  store?.upsertRow("complianceRemediations", {
    ...existing,
    _id: remediationId,
    _creationTime: existing?._creationTime ?? Date.now(),
    societyId,
    ruleId,
    flagLevel: args?.flagLevel ?? "info",
    flagText: args?.flagText ?? ruleId,
    evidenceRequired: Array.isArray(args?.evidenceRequired) ? args.evidenceRequired : [],
    status: args?.status ?? "open",
    targetTable: args?.targetTable,
    targetId: args?.targetId,
    resolvedAtISO: args?.resolvedAtISO,
    dismissedAtISO: args?.dismissedAtISO,
    notes: args?.notes,
    createdAtISO: existing?.createdAtISO ?? nowISO,
    updatedAtISO: nowISO,
  });
  return { remediationId, status: args?.status ?? "open", updated: Boolean(existing) };
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

function staticStageShareIssuancePacket(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  const societyId = args?.societyId ?? SOCIETY_ID;
  const transfer = store?.getRow("rightsholdingTransfers", args?.transferId);
  if (!transfer || transfer.societyId !== societyId) {
    throw new Error("Share issuance transfer was not found for this workspace.");
  }
  if (transfer.transferType !== "issuance") {
    throw new Error("Only issuance transfers can stage the share issuance packet.");
  }
  staticSeedCorporationDocumentPackets(store, { societyId });
  const packet = CORPORATION_DOCUMENT_PACKETS.find((candidate) => candidate.key === "issue-shares");
  if (!packet) throw new Error("Share issuance packet is not configured.");

  const marker = corporationPacketPrecedentMarker(packet);
  const precedent = (store?.listRows("legalPrecedents", { societyId }) ?? [])
    .find((row: any) => (row.sourceExternalIds ?? []).includes(marker));
  if (!precedent) throw new Error(`Corporation document packet precedent was not seeded: ${packet.key}`);

  const now = new Date().toISOString();
  const runId = staticLocalId("legalPrecedentRuns", packet.key);
  store?.transaction(() => {
    store.upsertRow("legalPrecedentRuns", {
      _id: runId,
      _creationTime: Date.now(),
      societyId,
      name: `${packet.packageName}${transfer.transferDate ? ` - ${transfer.transferDate}` : ""}`,
      status: "draft",
      precedentId: precedent._id,
      eventId: String(args?.transferId),
      dateTime: transfer.transferDate,
      dataJson: JSON.stringify({
        packetKey: packet.key,
        transferId: args?.transferId,
        transferType: transfer.transferType,
        transferDate: transfer.transferDate,
        rightsClassId: transfer.rightsClassId,
        destinationRoleHolderId: transfer.destinationRoleHolderId,
        destinationHolderName: transfer.destinationHolderName,
        quantity: transfer.quantity,
        considerationType: transfer.considerationType,
        considerationDescription: transfer.considerationDescription,
      }),
      dataJsonList: [],
      dataReviewed: false,
      externalNotes: "Share issuance packet staged from the share register.",
      searchIds: [],
      registrationIds: [],
      filingIds: [],
      generatedDocumentIds: [],
      signerRoleHolderIds: transfer.destinationRoleHolderId ? [transfer.destinationRoleHolderId] : [],
      priceItems: [],
      abstainingDirectorIds: [],
      abstainingRightsholderIds: [],
      sourceExternalIds: [
        `societyer:rightsholding-transfer:${args?.transferId}`,
        `societyer:corporation-packet-run:${packet.key}`,
      ],
      notes: args?.notes ?? `Staged share issuance packet for ledger transfer ${args?.transferId}.`,
      createdAtISO: now,
      updatedAtISO: now,
    });
    const artifacts = staticCreatePacketRunArtifacts(store, {
      societyId,
      packet,
      runId,
      eventId: String(args?.transferId),
      effectiveDate: transfer.transferDate,
      signerRoleHolderIds: transfer.destinationRoleHolderId ? [transfer.destinationRoleHolderId] : [],
      dataJson: JSON.stringify({
        packetKey: packet.key,
        transferId: args?.transferId,
        transferType: transfer.transferType,
        transferDate: transfer.transferDate,
        rightsClassId: transfer.rightsClassId,
        destinationRoleHolderId: transfer.destinationRoleHolderId,
        destinationHolderName: transfer.destinationHolderName,
        quantity: transfer.quantity,
        considerationType: transfer.considerationType,
        considerationDescription: transfer.considerationDescription,
      }),
      notes: args?.notes ?? `Editable share issuance packet output staged for ledger transfer ${args?.transferId}.`,
    }, staticLocalId, staticUniqueStrings);
    store.upsertRow("rightsholdingTransfers", {
      ...transfer,
      precedentRunId: runId,
      sourceDocumentIds: staticUniqueStrings([...(transfer.sourceDocumentIds ?? []), artifacts.draftDocumentId]),
      sourceExternalIds: staticUniqueStrings([
        ...(transfer.sourceExternalIds ?? []),
        `societyer:corporation-packet-run:${packet.key}`,
        `societyer:legal-precedent-run:${runId}`,
        `societyer:generated-legal-document:${artifacts.generatedDocumentId}`,
        `societyer:minute-book-item:${artifacts.minuteBookItemId}`,
        `societyer:source-evidence:${artifacts.sourceEvidenceId}`,
        ...artifacts.signerIds.map((signerId: string) => `societyer:legal-signer:${signerId}`),
      ]),
      notes: [transfer.notes, args?.notes ?? "Share issuance packet staged in Template Engine."].filter(Boolean).join("\n\n"),
      updatedAtISO: now,
    });
    staticSyncRightsHoldings(store, societyId);
  });
  const updatedRun = store?.getRow("legalPrecedentRuns", runId);
  const generatedDocumentId = updatedRun?.generatedDocumentIds?.[0];
  const generatedDocument = generatedDocumentId ? store?.getRow("generatedLegalDocuments", generatedDocumentId) : undefined;
  const draftDocumentVersionId = (generatedDocument?.sourceExternalIds ?? [])
    .map((sourceId: string) => sourceId.match(/^societyer:document-version:(.+)$/)?.[1])
    .find(Boolean);
  const signerIds = (store?.listRows("legalSigners", { societyId }) ?? [])
    .filter((row: any) => row.generatedDocumentId === generatedDocumentId)
    .map((row: any) => row._id);
  const minuteBookItem = (store?.listRows("minuteBookItems", { societyId }) ?? [])
    .find((row: any) => (row.documentIds ?? []).includes(generatedDocument?.draftDocumentId));
  const sourceEvidence = (store?.listRows("sourceEvidence", { societyId }) ?? [])
    .find((row: any) => row.sourceDocumentId === generatedDocument?.draftDocumentId);
  return {
    runId,
    packetKey: packet.key,
    precedentId: precedent._id,
    transferId: args?.transferId,
    draftDocumentId: generatedDocument?.draftDocumentId,
    draftDocumentVersionId,
    generatedDocumentId,
    signerIds,
    minuteBookItemId: minuteBookItem?._id,
    sourceEvidenceId: sourceEvidence?._id,
  };
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

function staticStageShareSplitPacket(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  const societyId = args?.societyId ?? SOCIETY_ID;
  const rightsClass = store?.getRow("rightsClasses", args?.rightsClassId);
  if (!rightsClass || rightsClass.societyId !== societyId) {
    throw new Error("Rights class was not found for this workspace.");
  }
  const ratio: SplitRatio = { numerator: Number(args?.numerator), denominator: Number(args?.denominator) };
  const validation = validateRatio(ratio);
  if (!validation.ok) throw new Error(`Invalid split ratio: ${validation.errors.join(" ")}`);

  const holdingRows = (store?.listRows("rightsHoldings", { societyId }) ?? [])
    .filter((row: any) => row.rightsClassId === args?.rightsClassId && row.quantity);
  const positions: HoldingPosition[] = holdingRows.map((row: any) => {
    const roleHolder = row.holderRoleHolderId ? store?.getRow("roleHolders", row.holderRoleHolderId) : null;
    const holderName = roleHolder?.fullName
      || (String(row.holderKey).startsWith("name:") ? String(row.holderKey).slice("name:".length) : String(row.holderKey));
    return {
      holderKey: String(row.holderKey),
      holderName,
      holderRoleHolderId: row.holderRoleHolderId ? String(row.holderRoleHolderId) : undefined,
      shares: Number(row.quantity),
    };
  });
  if (positions.length === 0) {
    throw new Error("This share class has no current holdings to subdivide or consolidate.");
  }

  const plan = planShareSplit(positions, ratio);
  staticSeedCorporationDocumentPackets(store, { societyId });
  const packet = CORPORATION_DOCUMENT_PACKETS.find((candidate) => candidate.key === "share-split");
  if (!packet) throw new Error("Share split packet is not configured.");
  const marker = corporationPacketPrecedentMarker(packet);
  const precedent = (store?.listRows("legalPrecedents", { societyId }) ?? [])
    .find((row: any) => (row.sourceExternalIds ?? []).includes(marker));
  if (!precedent) throw new Error(`Corporation document packet precedent was not seeded: ${packet.key}`);

  const now = new Date().toISOString();
  const effectiveDate = now.slice(0, 10);
  const eventId = `share-split:${args?.rightsClassId}:${now}`;
  const transferType = plan.kind === "subdivision" ? "subdivision" : "consolidation";
  const splitData = {
    packetKey: packet.key,
    rightsClassId: String(args?.rightsClassId),
    shareClassName: rightsClass.className,
    ratioLabel: plan.label,
    kind: plan.kind,
    totalBefore: plan.totalBefore,
    totalAfter: plan.totalAfter,
    sharesDropped: plan.sharesDropped,
    effectiveDate,
    lines: plan.lines.map((line) => ({ holderName: line.holderName, before: line.before, after: line.after })),
  };
  const runId = staticLocalId("legalPrecedentRuns", packet.key);
  const signerRoleHolderIds = (store?.listRows("roleHolders", { societyId }) ?? [])
    .filter((row: any) => row.status === "current" && ["director", "officer", "authorized_representative"].includes(row.roleType))
    .map((row: any) => row._id);

  store?.transaction(() => {
    for (const line of plan.lines) {
      if (line.delta === 0) continue;
      const gains = line.delta > 0;
      store.upsertRow("rightsholdingTransfers", {
        _id: staticLocalId("rightsholdingTransfers", "split"),
        _creationTime: Date.now(),
        societyId,
        transferType,
        status: "posted",
        transferDate: effectiveDate,
        eventId,
        rightsClassId: args?.rightsClassId,
        sourceRoleHolderId: gains ? undefined : line.holderRoleHolderId,
        sourceHolderName: gains ? undefined : line.holderName,
        destinationRoleHolderId: gains ? line.holderRoleHolderId : undefined,
        destinationHolderName: gains ? line.holderName : undefined,
        quantity: Math.abs(line.delta),
        considerationType: "share-split",
        considerationDescription: plan.label,
        sourceDocumentIds: [],
        sourceExternalIds: [`societyer:share-split:${eventId}`],
        notes: `${plan.label} of ${rightsClass.className}: ${line.before} → ${line.after} shares.`,
        createdAtISO: now,
        updatedAtISO: now,
      });
    }
    store.upsertRow("legalPrecedentRuns", {
      _id: runId,
      _creationTime: Date.now(),
      societyId,
      name: `${packet.packageName} - ${rightsClass.className} (${plan.label})`,
      status: "draft",
      precedentId: precedent._id,
      eventId,
      dateTime: effectiveDate,
      dataJson: JSON.stringify(splitData),
      dataJsonList: [],
      dataReviewed: false,
      externalNotes: "Share subdivision/consolidation packet staged from the share register.",
      searchIds: [],
      registrationIds: [],
      filingIds: [],
      generatedDocumentIds: [],
      signerRoleHolderIds,
      priceItems: [],
      abstainingDirectorIds: [],
      abstainingRightsholderIds: [],
      sourceExternalIds: [
        `societyer:share-split:${eventId}`,
        `societyer:corporation-packet-run:${packet.key}`,
      ],
      notes: args?.notes ?? `Staged ${plan.label} of ${rightsClass.className}.`,
      createdAtISO: now,
      updatedAtISO: now,
    });
    staticCreatePacketRunArtifacts(store, {
      societyId,
      packet,
      runId,
      eventId,
      effectiveDate,
      signerRoleHolderIds,
      dataJson: JSON.stringify(splitData),
      notes: args?.notes ?? `Editable ${plan.label} resolution for ${rightsClass.className}.`,
    }, staticLocalId, staticUniqueStrings);
    staticSyncRightsHoldings(store, societyId);
  });

  return {
    runId,
    packetKey: packet.key,
    precedentId: precedent._id,
    ratioLabel: plan.label,
    kind: plan.kind,
    totalBefore: plan.totalBefore,
    totalAfter: plan.totalAfter,
    sharesDropped: plan.sharesDropped,
  };
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

function staticImportSessionRows(store?: StaticDemoDexieStore | null, societyId?: string) {
  return (store?.listRows("documents", societyId ? { societyId } : undefined) ?? [])
    .filter(staticIsImportSession)
    .map(staticHydrateImportSession)
    .map((session) => ({ ...session, summary: staticImportSessionSummary(session, staticImportRecordRows(store, session._id)) }))
    .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
}

function staticImportRecordRows(store?: StaticDemoDexieStore | null, sessionId?: string) {
  return (store?.listRows("documents", {}) ?? [])
    .filter(staticIsImportRecord)
    .map(staticHydrateImportRecord)
    .filter((record) => !sessionId || record.sessionId === sessionId)
    .sort((a, b) => String(a.recordKind ?? "").localeCompare(String(b.recordKind ?? "")) || String(a.title ?? "").localeCompare(String(b.title ?? "")));
}

function staticHydrateImportSession(doc: any) {
  const payload = staticParseJson(doc?.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    name: payload.name ?? doc.title,
    createdAtISO: payload.createdAtISO ?? doc.createdAtISO,
  };
}

function staticHydrateImportRecord(doc: any) {
  const payload = staticParseJson(doc?.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    title: payload.title ?? doc.title,
    status: staticReviewStatus(payload.status),
    sourceExternalIds: Array.isArray(payload.sourceExternalIds) ? payload.sourceExternalIds : [],
    riskFlags: Array.isArray(payload.riskFlags) ? payload.riskFlags : [],
    importedTargets: payload.importedTargets ?? {},
  };
}

function staticImportSessionSummary(session: any, records: any[] = []) {
  const summary = session?.summary;
  if (summary && typeof summary === "object" && Number.isFinite(Number(summary.total))) return summary;
  return staticSummarizeImportRecords(records);
}

function staticSummarizeImportRecords(records: any[]) {
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byTarget: Record<string, number> = {};
  let riskCount = 0;
  for (const record of records) {
    byKind[record.recordKind] = (byKind[record.recordKind] ?? 0) + 1;
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    byTarget[record.targetModule] = (byTarget[record.targetModule] ?? 0) + 1;
    if ((record.riskFlags ?? []).length > 0) riskCount += 1;
  }
  return {
    total: records.length,
    byKind,
    byStatus,
    byTarget,
    riskCount,
    orgHistoryApplied: 0,
    meetingsApplied: 0,
    documentsApplied: 0,
    sectionsApplied: 0,
  };
}

function staticRecordsFromImportBundle(bundle: any) {
  const records: any[] = [];
  const pushRows = (key: string, recordKind: string, targetModule: string) => {
    for (const payload of staticArrayOf(bundle?.[key])) {
      records.push(staticImportRecord(recordKind, targetModule, payload));
    }
  };
  pushRows("sources", "source", "Org history sources");
  pushRows("facts", "fact", "Org history");
  pushRows("events", "event", "Org history");
  pushRows("boardTerms", "boardTerm", "Directors and roles");
  pushRows("motions", "motion", "Meetings and minutes");
  pushRows("meetingMinutes", "meetingMinutes", "Meetings and minutes");
  pushRows("documents", "documentCandidate", "Documents");
  pushRows("documentMap", "documentCandidate", "Documents");
  pushRows("filings", "filing", "filings");
  pushRows("deadlines", "deadline", "deadlines");
  pushRows("policies", "policy", "policies");
  pushRows("grants", "grant", "grants");
  pushRows("employees", "employee", "employees");
  pushRows("volunteers", "volunteer", "volunteers");
  for (const [key, value] of Object.entries(bundle ?? {})) {
    if (!Array.isArray(value) || records.some((record) => record.sourceCollection === key)) continue;
    for (const payload of value) records.push(staticImportRecord(staticSingularKind(key), key, payload, key));
  }
  return records;
}

function staticImportRecord(recordKind: string, targetModule: string, payload: any, sourceCollection?: string) {
  const title = staticImportRecordTitle(recordKind, payload);
  return {
    recordKind,
    targetModule,
    title,
    description: staticCleanText(payload?.description ?? payload?.summary ?? payload?.notes) ?? "",
    payload: payload && typeof payload === "object" ? payload : { value: payload },
    sourceExternalIds: staticArrayOf(payload?.sourceExternalIds ?? payload?.externalId ?? payload?.id).map(String),
    confidence: Number(payload?.confidence ?? 0.8),
    riskFlags: [],
    sourceCollection,
  };
}

function staticCreateImportSession(store: StaticDemoDexieStore | null | undefined, args: StaticArgs) {
  const records = staticRecordsFromImportBundle(args?.bundle);
  if (records.length === 0) throw new Error("Import bundle did not contain any supported records.");
  const now = new Date().toISOString();
  const sessionId = `static_import_session_${Date.now()}`;
  const sessionPayload = {
    kind: "importSession",
    name: staticCleanText(args?.name) || staticCleanText(args?.bundle?.metadata?.name) || "Local import session",
    sourceSystem: staticCleanText(args?.bundle?.metadata?.sourceSystem ?? args?.bundle?.sourceSystem) || "local",
    bundleMetadata: args?.bundle?.metadata ?? null,
    createdAtISO: now,
    updatedAtISO: now,
    status: "Reviewing",
    summary: staticSummarizeImportRecords(records.map((record) => ({ ...record, status: "Pending", importedTargets: {} }))),
  };
  store?.transaction(() => {
    store.upsertRow("documents", {
      _id: sessionId,
      _creationTime: Date.now(),
      societyId: args?.societyId ?? SOCIETY_ID,
      title: sessionPayload.name,
      category: STATIC_IMPORT_SESSION_CATEGORY,
      content: JSON.stringify(sessionPayload),
      createdAtISO: now,
      flaggedForDeletion: false,
      tags: [STATIC_IMPORT_SESSION_TAG, `source:${sessionPayload.sourceSystem}`],
    });
    records.forEach((record, index) => {
      const recordId = `static_import_record_${Date.now()}_${index}`;
      const payload = {
        ...record,
        sessionId,
        kind: "importRecord",
        status: "Pending",
        reviewNotes: staticCleanText(record.payload?.reviewNotes) || "",
        importedTargets: {},
        createdAtISO: now,
        updatedAtISO: now,
      };
      store.upsertRow("documents", {
        _id: recordId,
        _creationTime: Date.now() + index + 1,
        societyId: args?.societyId ?? SOCIETY_ID,
        title: record.title,
        category: STATIC_IMPORT_RECORD_CATEGORY,
        importSessionId: sessionId,
        importRecordKind: record.recordKind,
        content: JSON.stringify(payload),
        createdAtISO: now,
        flaggedForDeletion: false,
        tags: [STATIC_IMPORT_SESSION_TAG, STATIC_IMPORT_RECORD_TAG, `kind:${record.recordKind}`, `target:${record.targetModule}`],
      });
    });
  });
  return sessionId;
}

function staticPatchImportSessionUpdatedAt(store: StaticDemoDexieStore | null | undefined, sessionId: string | undefined) {
  const sessionDoc = store?.getRow("documents", sessionId);
  if (!sessionDoc || !staticIsImportSession(sessionDoc)) return;
  const session = staticHydrateImportSession(sessionDoc);
  store?.upsertRow("documents", {
    ...sessionDoc,
    content: JSON.stringify({ ...session, updatedAtISO: new Date().toISOString() }),
  });
}

function staticIsImportSession(doc: any) {
  return Boolean(doc?.tags?.includes(STATIC_IMPORT_SESSION_TAG) && !doc?.tags?.includes(STATIC_IMPORT_RECORD_TAG));
}

function staticIsImportRecord(doc: any) {
  return Boolean(doc?.tags?.includes(STATIC_IMPORT_SESSION_TAG) && doc?.tags?.includes(STATIC_IMPORT_RECORD_TAG));
}

function staticParseJson(value: unknown) {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function staticReviewStatus(value: unknown) {
  return value === "Approved" || value === "Rejected" ? value : "Pending";
}

function staticArrayOf(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function staticCleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function staticImportRecordTitle(recordKind: string, payload: any) {
  return staticCleanText(payload?.title ?? payload?.name ?? payload?.label ?? payload?.description) ?? `${recordKind} import`;
}

function staticSingularKind(value: string) {
  return value.replace(/ies$/, "y").replace(/s$/, "") || "record";
}

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
  private watchPortableQuery(name: string, args?: StaticArgs) {
    const store = this.store;
    const portable = this.portable;
    let asyncResult: any;
    let hasAsync = false;
    let disposed = false;
    let unsubStore: (() => void) | null = null;
    const subscribers = new Set<() => void>();

    const recompute = () => {
      portable
        .runQuery(name, args ?? {})
        .then((next) => {
          if (disposed) return;
          hasAsync = true;
          if (JSON.stringify(next) !== JSON.stringify(asyncResult)) {
            asyncResult = next;
            for (const callback of subscribers) callback();
          }
        })
        .catch((error) => {
          console.warn(`[societyer-local] portable query ${name} failed`, error);
        });
    };
    recompute();

    return {
      onUpdate: (callback: () => void) => {
        subscribers.add(callback);
        if (!unsubStore) unsubStore = store.onUpdate(() => recompute());
        return () => {
          subscribers.delete(callback);
          if (subscribers.size === 0 && unsubStore) {
            unsubStore();
            unsubStore = null;
            disposed = true;
          }
        };
      },
      localQueryResult: () => (hasAsync ? asyncResult : mutableQueryResult(name, args, store)),
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
    if (this.portable.kind(name) === "mutation") return this.portable.runMutation(name, args ?? {});
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
