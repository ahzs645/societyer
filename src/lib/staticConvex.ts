import { RECORD_TABLE_OBJECTS } from "../../convex/recordTableMetadataDefinitions";
import {
  CORPORATION_DOCUMENT_PACKETS,
  corporationPacketEntityTypes,
  corporationPacketPrecedentMarker,
  corporationPacketTemplateMarker,
} from "../../shared/corporationDocumentPackets";
import { BUILT_IN_GRANT_SOURCE_PROFILES, BUILT_IN_GRANT_SOURCES } from "../../shared/grantSourceLibrary";
import { materializeRightsHoldings, validateLedger } from "../../shared/equityLedger";
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
} from "./staticConvexDocuments";
import { INTEGRATION_CATALOG } from "../../shared/integrationCatalog";
import { DEFAULT_HOME_JURISDICTION_CODE, registryOnboardingCopy } from "../../shared/jurisdictionWorkspace";
import { LocalDexieRowStore, type LocalSeed, type LocalWorkspaceSnapshot } from "./localDexieRowStore";
import { STATIC_OFFLINE_NOOP_WRITES } from "./staticConvexParity";
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
  motionBacklog,
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
function reportStaticWriteGap(name: string): null {
  const message =
    `[staticConvex] No offline handler for write "${name}". ` +
    `This action does not persist in offline/desktop mode. ` +
    `Add a handler in staticConvex.ts (or list it in staticConvexParity.ts).`;
  const isDev = Boolean((import.meta as any)?.env?.DEV);
  if (isDev) throw new Error(message);
  if (typeof console !== "undefined") console.warn(message);
  return null;
}

function byId(rows: any[], id: string | undefined) {
  return rows.find((row) => row._id === id) ?? null;
}

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

function staticCsvRows(rows: unknown[][]) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\n");
}

function normalizeStaticCategoryLabel(value?: string) {
  return String(value ?? "").trim().toLowerCase();
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

function cycleItem(id: string, phase: string, title: string, detail: string, status: string, evidence: string[], dueDate: string | undefined, to: string, actionLabel: string) {
  return { id, phase, title, detail, status, evidence, dueDate, to, actionLabel };
}

function dateOnlyStatic(value?: string | null) {
  return String(value ?? "").slice(0, 10);
}

function inStaticYear(value: unknown, year: number) {
  return typeof value === "string" && value.slice(0, 4) === String(year);
}

function filingMatchesStaticYear(filing: any, year: number) {
  return String(filing.periodLabel ?? filing.title ?? "").includes(String(year)) || inStaticYear(filing.dueDate, year) || inStaticYear(filing.filedAt, year);
}

function addStaticDays(date: string, days: number) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function financialSummary() {
  return {
    totalBalance: financialAccounts.reduce((sum, account) => sum + account.balanceCents, 0),
    unrestricted: financialAccounts
      .filter((account) => !account.isRestricted)
      .reduce((sum, account) => sum + account.balanceCents, 0),
    restrictedAccounts: financialAccounts
      .filter((account) => account.isRestricted)
      .map((account) => ({
        name: account.name,
        balanceCents: account.balanceCents,
        purpose: account.restrictedPurpose,
      })),
    budgetRows: budgets.map((budget) => ({
      ...budget,
      actualCents: financialTransactions
        .filter((transaction) => transaction.category === budget.category)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0),
    })),
    recentTransactions: financialTransactions,
  };
}

function staticMonthlyEstimateCents(amountCents: number, interval: string) {
  if (interval === "semester") return Math.round((amountCents * 2) / 12);
  if (interval === "week") return Math.round((amountCents * 52) / 12);
  if (interval === "quarter") return Math.round(amountCents / 3);
  if (interval === "year") return Math.round(amountCents / 12);
  return amountCents;
}

function profitAndLoss(args: StaticArgs) {
  const from = args?.from ?? "2026-01-01";
  const to = args?.to ?? "2026-12-31";
  const rows = financialTransactions.filter((transaction) => transaction.date >= from && transaction.date <= to);
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

function budgetVariance() {
  return budgets.map((budget) => {
    const actualCents = financialTransactions
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

function staticAgendaItemType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve")) return "motion";
  if (lower.includes("report") || lower.includes("financial")) return "report";
  if (lower.includes("break")) return "break";
  if (lower.includes("camera") || lower.includes("closed") || lower.includes("executive")) return "executive_session";
  return "discussion";
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
  "motionBacklog",
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
    case "activity:list":
      return (store?.listRows("activity", args) ?? tables.activity)
        .sort((a: any, b: any) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")))
        .slice(0, args?.limit ?? tables.activity.length);
    case "importSessions:list":
      return staticImportSessionRows(store, args?.societyId);
    case "importSessions:get": {
      const sessionDoc = store?.getRow("documents", args?.sessionId);
      if (!staticIsImportSession(sessionDoc)) return null;
      const session = staticHydrateImportSession(sessionDoc);
      const records = staticImportRecordRows(store, args?.sessionId);
      return {
        session: { ...session, summary: staticImportSessionSummary(session, records) },
        records,
      };
    }
    case "aiAgents:listDefinitions":
      return aiAgentDefinitions;
    case "aiAgents:listSkills":
      return aiSkills.filter((skill: any) => skill.isActive !== false);
    case "aiAgents:listAllSkills":
      return aiSkills;
    case "aiAgents:loadSkills": {
      const names = new Set(args?.skillNames ?? []);
      const skills = aiSkills.filter((skill) => names.has(skill.name));
      return { skills, missing: [...names].filter((name) => !skills.some((skill) => skill.name === name)), message: `Loaded ${skills.length} skill(s).` };
    }
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
    case "assets:events":
      return (store?.listRows("assetEvents", args) ?? tables.assetEvents)
        .filter((row: any) => row.assetId === args?.assetId)
        .sort((a: any, b: any) => b.happenedAtISO.localeCompare(a.happenedAtISO));
    case "assets:maintenance":
      return store?.listRows("assetMaintenance", args) ?? scopedRows(tables.assetMaintenance, args);
    case "assets:verificationRuns":
      return store?.listRows("assetVerificationRuns", args) ?? scopedRows(tables.assetVerificationRuns, args);
    case "assets:verificationItems":
      return (store?.listRows("assetVerificationItems", args) ?? tables.assetVerificationItems)
        .filter((row: any) => row.runId === args?.runId);
    case "assets:receiptLinks": {
      const rows = store?.listRows("assetReceiptLinks", args) ?? scopedRows(tables.assetReceiptLinks, args);
      return args?.receiptDocumentId ? rows.filter((row: any) => row.receiptDocumentId === args.receiptDocumentId) : rows;
    }
    case "inventoryHub:connections":
      return store?.listRows("inventoryConnections", args) ?? scopedRows(tables.inventoryConnections, args);
    case "inventoryHub:items": {
      const rows = store?.listRows("inventoryItems", args) ?? scopedRows(tables.inventoryItems, args);
      return args?.itemType ? rows.filter((row: any) => row.itemType === args.itemType) : rows;
    }
    case "inventoryHub:locations":
      return store?.listRows("inventoryLocations", args) ?? scopedRows(tables.inventoryLocations, args);
    case "inventoryHub:balances": {
      const rows = store?.listRows("inventoryBalances", args) ?? scopedRows(tables.inventoryBalances, args);
      return args?.inventoryItemId ? rows.filter((row: any) => row.inventoryItemId === args.inventoryItemId) : rows;
    }
    case "inventoryHub:lots": {
      const rows = store?.listRows("inventoryLots", args) ?? scopedRows(tables.inventoryLots, args);
      return (args?.inventoryItemId ? rows.filter((row: any) => row.inventoryItemId === args.inventoryItemId) : rows)
        .slice()
        .sort((a: any, b: any) => String(a.expiresAt ?? "9999").localeCompare(String(b.expiresAt ?? "9999")));
    }
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesInventoryHub2(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "inventoryHub:stockMovements":
      return (store?.listRows("stockMovements", args) ?? scopedRows(tables.stockMovements, args))
        .sort((a: any, b: any) => b.movementDate.localeCompare(a.movementDate))
        .slice(0, args?.limit ?? 100);
    case "inventoryHub:counts": {
      const rows = store?.listRows("inventoryCounts", args) ?? scopedRows(tables.inventoryCounts, args);
      const filtered = args?.status ? rows.filter((row: any) => row.status === args.status) : rows;
      const lines = store?.listRows("inventoryCountLines", args) ?? scopedRows(tables.inventoryCountLines, args);
      return filtered
        .sort((a: any, b: any) => b.startedAtISO.localeCompare(a.startedAtISO))
        .map((count: any) => ({ ...count, lines: lines.filter((line: any) => line.inventoryCountId === count._id) }));
    }
    case "inventoryHub:receiptLinks": {
      const rows = store?.listRows("assetReceiptLinks", args) ?? scopedRows(tables.assetReceiptLinks, args);
      return (args?.inventoryItemId ? rows.filter((row: any) => row.inventoryItemId === args.inventoryItemId) : rows)
        .map((row: any) => ({
          ...row,
          receiptDocument: byId(store?.listRows("documents", args) ?? documents, row.receiptDocumentId),
          asset: byId(store?.listRows("assets", args) ?? tables.assets, row.assetId),
          inventoryItem: byId(store?.listRows("inventoryItems", args) ?? tables.inventoryItems, row.inventoryItemId),
        }));
    }
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
    case "annualCycle:summary":
      return annualCycleSummary(args);
    case "aiAgents:listRuns":
      return aiAgentRuns.slice(0, args?.limit ?? aiAgentRuns.length);
    case "aiAgents:auditForRun":
      return aiAgentAuditEvents.filter((event) => event.runId === args?.runId);
    case "aiAgents:listToolDrafts":
      return aiToolDrafts.slice(0, args?.limit ?? aiToolDrafts.length);
    case "aiSettings:getEffective": {
      const personal = aiProviderSettings.filter((row) => row.societyId === args?.societyId && row.userId === args?.actingUserId);
      const workspace = aiProviderSettings.filter((row) => row.societyId === args?.societyId && row.scope === "workspace");
      return {
        effective: personal.find((row) => row.status === "active") ?? workspace.find((row) => row.status === "active") ?? null,
        personal,
        workspace,
      };
    }
    case "aiChat:listThreads":
      return aiChatThreads.slice(0, args?.limit ?? aiChatThreads.length);
    case "aiChat:messagesForThread":
      return aiMessages.filter((message) => message.threadId === args?.threadId);
    case "apiPlatform:listIntegrationCatalog":
      return INTEGRATION_CATALOG.map((manifest) => {
        const installation = tables.pluginInstallations.find((row) => row.slug === manifest.slug);
        return {
          ...manifest,
          installation,
          installed: installation?.status === "installed",
          health: {
            status: installation ? (manifest.status === "planned" ? "planned" : "ready") : "not_installed",
            checkedAtISO: installation?.updatedAtISO,
            messages: installation
              ? ["Static demo integration manifest is installed."]
              : ["Install this integration to configure credentials, actions, and webhooks."],
          },
        };
      });
    case "recordLayouts:get":
      return null;
    case "agm:noticeDeliveries":
      return [];
    case "agm:runForMeeting":
      return { _id: "static_agm_run", meetingId: args?.meetingId, status: "Ready", steps: [] };
    case "agendas:getForMeeting": {
      const meeting = byId(meetings, args?.meetingId);
      if (!meeting) return null;
      const items = staticAgendaItemsForMeeting(meeting._id).map((entry, order) => ({
        _id: `static_agenda_item_${meeting._id}_${order}`,
        societyId: meeting.societyId,
        agendaId: `static_agenda_${meeting._id}`,
        order,
        type: entry.type || staticAgendaItemType(entry.title),
        title: entry.title,
        depth: entry.depth,
        presenter: entry.presenter,
        details: entry.details,
        motionText: entry.motionText,
        createdAtISO: meeting.scheduledAt,
      }));
      if (items.length === 0) return null;
      return {
        agenda: {
          _id: `static_agenda_${meeting._id}`,
          societyId: meeting.societyId,
          meetingId: meeting._id,
          title: `${meeting.title} agenda`,
          status: "Draft",
          createdAtISO: meeting.scheduledAt,
          updatedAtISO: meeting.updatedAtISO ?? meeting.scheduledAt,
        },
        items,
      };
    }
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesAgendas3(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "agendas:listForSociety":
      return scopedRows(meetings, args)
        .map((meeting) => ({
          _id: `static_agenda_${meeting._id}`,
          societyId: meeting.societyId,
          meetingId: meeting._id,
          title: `${meeting.title} agenda`,
          status: "Draft",
          createdAtISO: meeting.scheduledAt,
          updatedAtISO: meeting.updatedAtISO ?? meeting.scheduledAt,
        }));
    case "attestations:missingForYear":
      return directors.filter((director) => director._id === "static_director_sam");
    case "bylawRules:getActive":
    case "bylawRules:getForDate":
      return bylawRules;
    case "bylawRules:list":
      return tables.bylawRuleSets;
    case "committees:detail":
      return { committee: byId(committees, args?.id), members: [], meetings: [], tasks, goals };
    case "commitments:eventsForSociety":
      return scopedRows(commitmentEvents, args).sort((a, b) => b.happenedAtISO.localeCompare(a.happenedAtISO));
    case "commitments:eventsForCommitment":
      return commitmentEvents.filter((event) => event.commitmentId === args?.commitmentId);
    case "dashboard:summary":
      return dashboardSummaryFromStore(store, args);
    case "documentComments:listForDocument":
      return documentComments
        .filter((comment) => comment.documentId === args?.documentId)
        .sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO));
    case "documents:reviewQueues":
      return staticDocumentReviewQueuesFromStore(store, args);
    case "documentVersions:latest": {
      const rows = store?.listRows("documentVersions", args) ?? scopedRows(tables.documentVersions, args);
      return rows
        .filter((row) => row.documentId === args?.documentId)
        .sort((a, b) => b.version - a.version)[0] ?? null;
    }
    case "documentVersions:listForDocument":
      return (store?.listRows("documentVersions", args) ?? scopedRows(tables.documentVersions, args))
        .filter((row) => row.documentId === args?.documentId)
        .sort((a, b) => b.version - a.version);
    case "evidenceRegisters:overview":
      return evidenceRegistersOverview;
    case "organizationHistory:list":
      return orgHistoryBundle;
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
    case "paperless:listConnection":
      return paperlessConnections[0];
    case "paperless:recentSyncs":
      return paperlessDocumentSyncs
        .slice(0, args?.limit ?? paperlessDocumentSyncs.length)
        .map((sync) => ({
          ...sync,
          documentTitle: byId(documents, sync.documentId)?.title ?? sync.title,
          documentCategory: byId(documents, sync.documentId)?.category,
        }));
    case "paperless:syncForDocument":
      return paperlessDocumentSyncs.find((sync) => sync.documentId === args?.documentId) ?? null;
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
    case "elections:get":
      return electionBundle(args);
    case "elections:listMine":
      return mineElections(args);
    case "elections:listNominations":
      return [];
    case "elections:tally":
      return electionTally(args);
    case "exports:countTablePage":
      return { count: staticExportRows(args?.table, args).length, isDone: true, continueCursor: "" };
    case "exports:exportTable":
      return staticExportRows(args?.table, args);
    case "exports:exportWorkspace":
      return staticExportWorkspace(args);
    case "exports:listExportableTables":
      return staticExportSummaries(args);
    case "exports:validateCurrentDatabase":
      return staticExportValidation(args);
    case "filingBot:buildFilingPacket":
      return { filing: byId(filings, args?.filingId), documents: [] };
    case "filingBot:runsForFiling":
      return [];
    case "filingExports:craPreFill":
      return {
        form: "CRA T3010 Registered Charity Information Return",
        charityName: society.name,
        fiscalPeriodEnd: "2026-03-31",
        totalRevenue: 186400,
        totalExpenditures: 171250,
        netAssets: 62400,
        directorCount: directors.filter((director) => director.status === "Active").length,
        dueDate: "2026-09-30",
      };
    case "filingExports:societiesOnlinePreFill":
      return {
        formName: "BC Societies Annual Report",
        societyName: society.name,
        incorporationNumber: society.incorporationNumber,
        agmHeldOn: "2025-06-19",
        registeredOffice: society.registeredOfficeAddress,
        mailingAddress: society.mailingAddress,
        directors: directors.map((director) => ({
          fullName: `${director.firstName} ${director.lastName}`,
          position: director.position,
          email: director.email,
          isBCResident: director.isBCResident,
          termStart: director.termStart,
        })),
        feeCad: 40,
      };
    case "financials:detailByFiscalYear": {
      const financial = financials.find((row) => row.fiscalYear === args?.fiscalYear) ?? null;
      const financialDocument = documents.find((row) => row._id === "static_document_financials");
      return {
        financial,
        financials: financial ? [financial] : [],
        imports: [],
        documents: financialDocument ? [financialDocument] : [],
        budgets: [],
        presentedAtMeeting: null,
      };
    }
    case "accounting:chartAccounts":
      return scopedRows(store?.listRows("financialAccounts", args) ?? financialAccounts, args)
        .sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")) || a.name.localeCompare(b.name));
    case "accounting:fiscalPeriods":
      return scopedRows(store?.listRows("accountingFiscalPeriods", args) ?? accountingFiscalPeriods, args)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    case "accounting:counterparties":
      return scopedRows(store?.listRows("accountingCounterparties", args) ?? accountingCounterparties, args)
        .sort((a, b) => a.name.localeCompare(b.name));
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesAccounting5(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "accounting:fundRestrictions":
      return scopedRows(store?.listRows("fundRestrictions", args) ?? fundRestrictions, args)
        .sort((a, b) => a.name.localeCompare(b.name));
    case "accounting:restrictedFundBalances":
      return staticRestrictedFundBalances(staticAccountingSeed(store, args), args);
    case "accounting:accountMappings":
      return scopedRows(store?.listRows("accountingAccountMappings", args) ?? accountingAccountMappings, args)
        .sort((a, b) => `${a.provider}:${a.externalAccountName}`.localeCompare(`${b.provider}:${b.externalAccountName}`));
    case "accounting:journalEntries": {
      const entries = scopedRows(store?.listRows("journalEntries", args) ?? journalEntries, args)
        .filter((entry) => !args?.status || entry.status === args.status)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, args?.limit ?? 100);
      const lines = store?.listRows("journalLines", args) ?? journalLines;
      return entries.map((entry) => ({
        ...entry,
        lines: lines.filter((line) => line.journalEntryId === entry._id).sort((a, b) => a.lineOrder - b.lineOrder),
      }));
    }
    case "accounting:journalEntry": {
      const entry = byId(store?.listRows("journalEntries", args) ?? journalEntries, args?.id);
      if (!entry) return null;
      const lines = store?.listRows("journalLines", args) ?? journalLines;
      return { ...entry, lines: lines.filter((line) => line.journalEntryId === entry._id).sort((a, b) => a.lineOrder - b.lineOrder) };
    }
    case "accounting:trialBalance":
      return staticTrialBalance(staticAccountingSeed(store, args), args);
    case "accounting:generalLedger":
      return staticGeneralLedger(staticAccountingSeed(store, args), args);
    case "accounting:exportCsv":
      return staticAccountingCsv(staticAccountingSeed(store, args), args);
    case "accounting:boardAuditorPackage":
      return staticBoardAuditorPackage(staticAccountingSeed(store, args), args);
    case "financialHub:accounts":
      return financialAccounts;
    case "financialHub:connections":
      return financialConnections;
    case "financialHub:getConnection":
      return byId(financialConnections, args?.id) ?? financialConnections[0];
    case "financialHub:oauthUrl":
      return { provider: "wave", live: false, demoAvailable: true };
    case "financialHub:summary":
      return financialSummary();
    case "financialHub:transactions":
      return financialTransactions.slice(0, args?.limit ?? financialTransactions.length);
    case "financialHub:transactionsForAccountExternalId": {
      const account = financialAccounts.find((row) => row.externalId === args?.externalId) ?? null;
      const rows = account
        ? financialTransactions
            .filter((row) => row.accountId === account._id)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [];
      return {
        account,
        transactions: rows.slice(0, args?.limit ?? 500),
        total: rows.length,
      };
    }
    case "financialHub:transactionsForCounterpartyExternalId": {
      const rows = financialTransactions
        .filter((row) => row.counterpartyExternalId === args?.externalId)
        .filter((row) => !args?.resourceType || row.counterpartyResourceType === args.resourceType)
        .sort((a, b) => b.date.localeCompare(a.date));
      return {
        transactions: rows.slice(0, args?.limit ?? 500).map((row) => {
          const account = financialAccounts.find((candidate) => candidate._id === row.accountId) ?? null;
          const accountResource = account
            ? waveCacheResources.find((resource) => resource.resourceType === "account" && resource.externalId === account.externalId) ?? null
            : null;
          return { ...row, account, accountResource };
        }),
        total: rows.length,
        linkedTotalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
      };
    }
    case "financialHub:transactionsForCategoryAccountExternalId": {
      const normalizedLabel = normalizeStaticCategoryLabel(args?.label);
      const rows = financialTransactions
        .filter((row) => {
          if (row.categoryAccountExternalId === args?.externalId) return true;
          return Boolean(!row.categoryAccountExternalId && normalizedLabel && normalizeStaticCategoryLabel(row.category) === normalizedLabel);
        })
        .sort((a, b) => b.date.localeCompare(a.date));
      return {
        transactions: rows.slice(0, args?.limit ?? 500).map((row) => {
          const account = financialAccounts.find((candidate) => candidate._id === row.accountId) ?? null;
          const accountResource = account
            ? waveCacheResources.find((resource) => resource.resourceType === "account" && resource.externalId === account.externalId) ?? null
            : null;
          return { ...row, account, accountResource };
        }),
        total: rows.length,
        linkedTotalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
      };
    }
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesFinancialHub6(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "financialHub:operatingSubscriptions":
      return operatingSubscriptions.map((row) => {
        const monthlyEstimateCents = staticMonthlyEstimateCents(row.amountCents, row.interval);
        return {
          ...row,
          monthlyEstimateCents,
          annualEstimateCents: monthlyEstimateCents * 12,
        };
      });
    case "library:overview":
      return staticLibraryOverview();
    case "fundingSources:list":
      return staticFundingSourcesList();
    case "fundingSources:rollup":
      return staticFundingRollup(args);
    case "waveCache:summary": {
      const snapshot = waveCacheSnapshots[0];
      return {
        ...snapshot,
        resourceCounts: JSON.parse(snapshot.resourceCountsJson),
      };
    }
    case "waveCache:resources": {
      const needle = args?.search?.trim?.().toLowerCase?.();
      return waveCacheResources
        .filter((row) => !args?.resourceType || row.resourceType === args.resourceType)
        .filter((row) => !needle || row.searchText.includes(needle))
        .slice(0, args?.limit ?? waveCacheResources.length)
        .map(({ rawJson, ...row }) => ({
          ...row,
          ...staticCounterpartyStats(row.externalId),
          ...staticCategoryAccountStats(row.externalId, row.label),
          hasRawJson: Boolean(rawJson),
        }));
    }
    case "waveCache:resource": {
      const row = byId(waveCacheResources, args?.id);
      return row
        ? { ...row, ...staticCounterpartyStats(row.externalId), ...staticCategoryAccountStats(row.externalId, row.label), raw: JSON.parse(row.rawJson) }
        : null;
    }
    case "waveCache:resourceByExternalId": {
      const row = waveCacheResources.find(
        (resource) =>
          resource.externalId === args?.externalId &&
          (!args?.resourceType || resource.resourceType === args.resourceType),
      );
      return row
        ? { ...row, ...staticCounterpartyStats(row.externalId), ...staticCategoryAccountStats(row.externalId, row.label), raw: JSON.parse(row.rawJson) }
        : null;
    }
    case "waveCache:structures":
      return waveCacheStructures.slice(0, args?.limit ?? waveCacheStructures.length).map((row) => ({
        ...row,
        fields: JSON.parse(row.fieldsJson),
      }));
    case "grants:applications":
      return tables.grantApplications;
    case "grants:publicOpenings":
      return tables.grants.filter((grant) => grant.allowPublicApplications);
    case "grants:reports":
      return tables.grantReports;
    case "grants:summary":
      return grantsSummary();
    case "grants:transactions":
      return tables.grantTransactions;
    case "grantSources:library":
      return staticGrantSourceLibrary();
    case "grantSources:list":
      return tables.grantSources;
    case "grantSources:listWithLibrary":
      return {
        library: staticGrantSourceLibrary().map((source: any) => ({
          ...source,
          _id: tables.grantSources.find((row) => row.libraryKey === source.libraryKey)?._id,
          installed: tables.grantSources.some((row) => row.libraryKey === source.libraryKey),
        })),
        workspace: tables.grantSources,
      };
    case "grantSources:candidates":
      return tables.grantOpportunityCandidates;
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesMembers7(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "members:get":
      return store?.getRow("members", args?.id) ?? byId(members, args?.id);
    case "meetings:get":
      return byId(meetings, args?.id) ?? meetings[0];
    case "meetingMaterials:packageForMeeting":
      return staticMeetingPackage(args);
    case "meetingMaterials:listForMeeting":
      return staticMeetingPackage(args).materials;
    case "meetingMaterials:listForSociety":
      return meetingMaterials.map((material) => ({
        ...material,
        document: byId(documents, material.documentId),
        meeting: byId(meetings, material.meetingId),
      }));
    case "minutes:getByMeeting":
      return minutes.find((row) => row.meetingId === args?.meetingId) ?? null;
    case "notifications:list":
      return notifications.slice(0, args?.limit ?? notifications.length);
    case "notifications:unreadCount":
      return notifications.filter((notification) => !notification.readAt).length;
    case "objectMetadata:getFullTableSetup":
      return staticRecordTableSetup(args);
    case "publicPortal:getSocietyBySlug":
      return society.publicSlug === args?.slug ? society : null;
    case "publicPortal:grantIntakeContext":
      if (args?.slug !== society.publicSlug || !society.publicTransparencyEnabled || !society.publicGrantIntakeEnabled) return null;
      return { society, grants: tables.grants.filter((grant) => grant.allowPublicApplications), committees };
    case "publicPortal:volunteerIntakeContext":
      if (args?.slug !== society.publicSlug || !society.publicTransparencyEnabled || !society.publicVolunteerIntakeEnabled) return null;
      return { society, grants: tables.grants, committees };
    case "signatures:listForEntity":
      return (store?.listRows("signatures", {}) ?? [])
        .filter((row: any) => row.entityType === args?.entityType && row.entityId === args?.entityId)
        .sort((a: any, b: any) => String(a.signedAtISO ?? "").localeCompare(String(b.signedAtISO ?? "")));
    case "signatures:listProfilesForSociety":
      return (store?.listRows("signatureProfiles", { societyId: args?.societyId ?? SOCIETY_ID }) ?? [])
        .sort((a: any, b: any) => String(a.signerName ?? "").localeCompare(String(b.signerName ?? "")));
    case "retention:expiredForSociety":
      return [];
    case "subscriptions:allSubscriptions":
      return memberSubscriptions;
    case "subscriptions:getPlan":
      return byId(subscriptionPlans, args?.id);
    case "subscriptions:feeTimeline":
      return membershipFeePeriods
        .map((period) => ({
          ...period,
          planName: subscriptionPlans.find((plan) => plan._id === period.planId)?.name,
          activePlan: subscriptionPlans.find((plan) => plan._id === period.planId)?.active,
        }))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.label.localeCompare(b.label));
    case "subscriptions:plans":
      return subscriptionPlans;
    case "transcripts:getByMeeting":
    case "transcripts:jobForMeeting":
      return null;
  }
  return QUERY_NOT_HANDLED;
}

function queryCasesTransparency8(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  switch (name) {
    case "transparency:listPublications":
      return tables.transparency;
    case "transparency:publicCenter":
      return publicCenter(args);
    case "treasury:budgetVariance":
      return budgetVariance();
    case "treasury:profitAndLoss":
      return profitAndLoss(args);
    case "treasury:restrictedFunds":
      return restrictedFunds();
    case "orgChartAssignments:list":
      return tables.orgChartAssignments;
    case "users:get":
      return store?.getRow("users", args?.id) ?? byId(users, args?.id) ?? users[0];
    case "permissions:myPermissions": {
      const permUser = store?.getRow("users", args?.userId) ?? byId(users, args?.userId) ?? users[0];
      return { role: permUser?.role ?? "Owner", permissions: staticPermissionsForRole(permUser?.role ?? "Owner") };
    }
    case "permissions:check": {
      const permUser = store?.getRow("users", args?.userId) ?? byId(users, args?.userId) ?? users[0];
      return staticPermissionsForRole(permUser?.role ?? "Owner").includes(args?.permission);
    }
    case "volunteers:applications":
      return tables.volunteerApplications;
    case "volunteers:screenings":
      return tables.volunteerScreenings;
    case "volunteers:summary":
      return { active: tables.volunteers.length, pendingApplications: tables.volunteerApplications.length };
    case "workflows:listCatalog":
      return workflowCatalog;
    case "workflows:list":
      return scopedRows(workflows, args);
    case "workflows:get":
      return byId(workflows, args?.id);
    case "workflows:listRuns":
      return workflowRuns.slice(0, args?.limit ?? workflowRuns.length);
    case "workflows:runsForWorkflow":
      return workflowRuns.filter((run) => run.workflowId === args?.workflowId);
    case "workflows:getRun":
      return byId(workflowRuns, args?.id);
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
  {
    const ycn = ycnQueryResult(moduleName, exportName, args, store as any);
    if (ycn !== YCN_NOT_HANDLED) return ycn;
  }
  if (moduleName === "legalOperations" && exportName === "rightsLedger") {
    const classes = (store?.listRows("rightsClasses", args) ?? [])
      .sort((a, b) => String(a.className ?? "").localeCompare(String(b.className ?? "")));
    const holdings = (store?.listRows("rightsHoldings", args) ?? [])
      .sort((a, b) => String(a.rightsClassId ?? "").localeCompare(String(b.rightsClassId ?? "")) || String(a.holderKey ?? "").localeCompare(String(b.holderKey ?? "")));
    const transfers = (store?.listRows("rightsholdingTransfers", args) ?? [])
      .sort((a, b) => String(b.transferDate ?? b.createdAtISO ?? "").localeCompare(String(a.transferDate ?? a.createdAtISO ?? "")));
    const roleHolders = (store?.listRows("roleHolders", args) ?? [])
      .sort((a, b) => String(a.fullName ?? "").localeCompare(String(b.fullName ?? "")));
    return { classes, holdings, transfers, roleHolders };
  }
  if (moduleName === "legalOperations" && exportName === "templateEngine") {
    return staticTemplateEngine(store, args);
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

  if (name === "society:updateModules") {
    const existing = store?.getRow("societies", args?.societyId) ?? society;
    store?.upsertRow("societies", {
      ...existing,
      _id: args?.societyId ?? existing._id,
      disabledModules: args?.disabledModules ?? [],
      updatedAtISO: new Date().toISOString(),
    });
    return args?.societyId ?? existing._id;
  }

  {
    const ycn = ycnMutationResult(name, args, store as any, staticLocalId, society);
    if (ycn !== YCN_NOT_HANDLED) return ycn;
  }

  if (name === "complianceObligations:markReviewed") {
    return staticUpsertComplianceDecision(store, {
      ...args,
      status: "resolved",
      resolvedAtISO: new Date().toISOString(),
      notes: args?.notes ?? "Marked reviewed from compliance obligations.",
    });
  }

  if (name === "complianceObligations:dismissDecision") {
    return staticUpsertComplianceDecision(store, {
      ...args,
      status: "dismissed",
      dismissedAtISO: new Date().toISOString(),
      notes: args?.notes ?? "Dismissed from compliance obligations.",
    });
  }

  if (name === "complianceObligations:reopenDecision") {
    return staticUpsertComplianceDecision(store, {
      ...args,
      status: "open",
      notes: "Reopened from compliance obligations.",
    });
  }

  if (name === "legalOperations:seedCorporationDocumentPackets") {
    return staticSeedCorporationDocumentPackets(store, args);
  }

  if (name === "legalOperations:seedSocietyDocumentPackets") {
    return staticSeedSocietyDocumentPackets(store, args);
  }

  if (name === "legalOperations:seedDocumentPacketsForEntity") {
    const soc = store?.getRow("societies", args?.societyId) ?? society;
    const kind = String(soc?.entityType ?? "").includes("corporation") || String(soc?.actFormedUnder ?? "").includes("corporations_act") ? "corporation" : "society";
    return kind === "corporation"
      ? { kind, ...staticSeedCorporationDocumentPackets(store, args) }
      : { kind, ...staticSeedSocietyDocumentPackets(store, args) };
  }

  if (name === "legalOperations:stageCorporationDocumentPacket") {
    return staticStageCorporationDocumentPacket(store, args, staticLocalId, staticUniqueStrings);
  }

  if (name === "legalOperations:stageShareIssuancePacket") {
    return staticStageShareIssuancePacket(store, args);
  }

  if (name === "importSessions:createFromBundle") {
    return staticCreateImportSession(store, args);
  }

  if (name === "importSessions:updateRecord") {
    const doc = store?.getRow("documents", args?.recordId);
    if (!staticIsImportRecord(doc)) return null;
    const record = staticHydrateImportRecord(doc);
    const next = {
      ...record,
      status: staticReviewStatus(args?.status ?? record.status),
      reviewNotes: args?.reviewNotes != null ? String(args.reviewNotes) : record.reviewNotes,
      payload: args?.payload ?? record.payload,
      sourceExternalIds: args?.sourceExternalIds ?? record.sourceExternalIds,
      updatedAtISO: new Date().toISOString(),
    };
    store?.upsertRow("documents", {
      ...doc,
      title: next.title,
      content: JSON.stringify(next),
    });
    staticPatchImportSessionUpdatedAt(store, next.sessionId);
    return args?.recordId;
  }

  if (name === "importSessions:bulkSetStatus") {
    const wanted = staticReviewStatus(args?.status);
    const recordIds = Array.isArray(args?.recordIds) ? new Set(args.recordIds) : null;
    let updated = 0;
    store?.transaction(() => {
      for (const doc of store.listRows("documents", {}).filter(staticIsImportRecord)) {
        const record = staticHydrateImportRecord(doc);
        if (record.sessionId !== args?.sessionId) continue;
        if (recordIds && !recordIds.has(record._id)) continue;
        store.upsertRow("documents", {
          ...doc,
          content: JSON.stringify({ ...record, status: wanted, updatedAtISO: new Date().toISOString() }),
        });
        updated += 1;
      }
      staticPatchImportSessionUpdatedAt(store, args?.sessionId);
    });
    return { updated };
  }

  return MUT_NOT_HANDLED;
}

function mutCasesImportSessions2(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "importSessions:removeSession") {
    store?.transaction(() => {
      for (const record of staticImportRecordRows(store, args?.sessionId)) store.removeRow("documents", record._id);
      store.removeRow("documents", args?.sessionId);
    });
    return null;
  }

  if (
    name === "importSessions:applyApprovedToOrgHistory" ||
    name === "importSessions:applyApprovedMeetings" ||
    name === "importSessions:backfillApprovedMeetingReferences" ||
    name === "importSessions:applyApprovedDocuments" ||
    name === "importSessions:applyApprovedSectionRecords"
  ) {
    return { deferred: true, updated: 0, applied: 0, message: "Local import apply is not enabled yet." };
  }

  if (name === "aiChat:createThread") {
    const now = new Date().toISOString();
    const thread = {
      _id: `static_ai_chat_thread_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      title: args?.title ?? "New AI chat",
      status: "active",
      modelId: args?.modelId,
      browsingContext: args?.browsingContext,
      createdByUserId: args?.actingUserId,
      createdAtISO: now,
      updatedAtISO: now,
      lastMessageAtISO: now,
    };
    aiChatThreads.unshift(thread);
    return thread._id;
  }
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
  if (name === "aiSettings:upsert") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_ai_provider_${Date.now()}`;
    const existing = aiProviderSettings.find((row) => row._id === id);
    const row = {
      _id: id,
      societyId: args?.societyId ?? SOCIETY_ID,
      scope: args?.scope ?? "personal",
      userId: args?.scope === "workspace" ? undefined : args?.actingUserId,
      provider: args?.provider ?? "openai",
      label: args?.label ?? "OpenAI",
      status: args?.validationStatus === "ok" ? "active" : "needs_validation",
      modelId: args?.modelId ?? "gpt-4.1-mini",
      baseUrl: args?.baseUrl,
      secretVaultItemId: args?.secretVaultItemId,
      temperature: args?.temperature,
      maxSteps: args?.maxSteps,
      validationStatus: args?.validationStatus,
      validationMessage: args?.validationMessage,
      validatedAtISO: args?.validationStatus === "ok" ? now : undefined,
      createdAtISO: now,
      updatedAtISO: now,
    };
    if (existing) Object.assign(existing, row);
    else aiProviderSettings.unshift(row);
    return id;
  }
  if (name === "aiSettings:setStatus") {
    const existing = aiProviderSettings.find((row) => row._id === args?.id);
    if (existing) existing.status = args?.status;
    return args?.id;
  }
  if (name === "secrets:create") {
    return `static_secret_${Date.now()}`;
  }
  if (name === "aiAgents:upsertSkill") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_ai_skill_${Date.now()}`;
    const existing = aiSkills.find((skill: any) => skill._id === id);
    const payload = {
      _id: id,
      name: args?.name,
      label: args?.label,
      description: args?.description,
      content: args?.content,
      isActive: args?.isActive !== false,
      isCustom: true,
      createdAtISO: now,
      updatedAtISO: now,
    };
    if (existing) Object.assign(existing, payload);
    else aiSkills.push(payload);
    return id;
  }
  if (name === "aiAgents:setSkillActive") {
    const existing = aiSkills.find((skill: any) => skill._id === args?.id);
    if (existing) existing.isActive = args?.isActive;
    return args?.id;
  }
  if (name === "aiAgents:removeSkill") {
    const idx = aiSkills.findIndex((skill: any) => skill._id === args?.id);
    if (idx >= 0) aiSkills.splice(idx, 1);
    return args?.id;
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
  if (name === "aiAgents:approveToolDraft") {
    const draft = aiToolDrafts.find((item) => item._id === args?.id);
    if (draft) draft.status = "executed";
    return { status: "executed", taskId: `static_task_${Date.now()}` };
  }
  if (name === "aiAgents:rejectToolDraft") {
    const draft = aiToolDrafts.find((item) => item._id === args?.id);
    if (draft) draft.status = "rejected";
    return args?.id;
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
  if (name === "apiPlatform:installIntegration") {
    const manifest = INTEGRATION_CATALOG.find((item) => item.slug === args?.slug);
    if (!manifest) return "static_integration_unknown";
    const now = new Date().toISOString();
    const existing = tables.pluginInstallations.find((row) => row.slug === manifest.slug);
    if (existing) {
      existing.status = "installed";
      existing.updatedAtISO = now;
      existing.configJson = JSON.stringify({ manifestVersion: 1, actions: manifest.actions }, null, 2);
      return existing._id;
    }
    const row = {
      _id: `static_integration_${manifest.slug}`,
      _creationTime: Date.now(),
      societyId: args?.societyId ?? SOCIETY_ID,
      name: manifest.name,
      slug: manifest.slug,
      status: "installed",
      capabilities: manifest.capabilities,
      configJson: JSON.stringify({ manifestVersion: 1, actions: manifest.actions }, null, 2),
      installedByUserId: args?.installedByUserId,
      createdAtISO: now,
      updatedAtISO: now,
    };
    tables.pluginInstallations.push(row);
    return row._id;
  }
  if (name === "apiPlatform:updateIntegrationHealth") return null;
  if (name === "workflowPackages:createBoardPack") {
    return {
      packageId: "static_board_pack_package",
      taskIds: [
        "static_board_pack_prepare_agenda",
        "static_board_pack_attach_materials",
        "static_board_pack_send_notice",
        "static_board_pack_record_quorum",
        "static_board_pack_draft_minutes",
        "static_board_pack_publish",
      ],
    };
  }
  if (name === "recordLayouts:upsert") return "static_record_layout";
  if (name === "recordLayouts:remove") return null;
  if (name === "views:seedGovernanceDataTableViews") {
    return {
      created: ["Open AGM tasks", "Missing filing evidence", "Directors needing attestation", "Unresolved conflicts", "Grant reports due"],
      skipped: [],
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
  if (name === "accounting:seedSocietyChartOfAccounts") {
    return { inserted: 0, skipped: financialAccounts.length };
  }
  if (name === "accounting:upsertFiscalPeriod") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_accounting_period_${Date.now()}`;
    store?.upsertRow("accountingFiscalPeriods", {
      _id: id,
      societyId: args?.societyId ?? SOCIETY_ID,
      fiscalYear: args?.fiscalYear,
      periodLabel: args?.periodLabel,
      startDate: args?.startDate,
      endDate: args?.endDate,
      status: args?.status ?? "open",
      notes: args?.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    return id;
  }
  if (name === "accounting:closeFiscalPeriod" || name === "accounting:reopenFiscalPeriod") {
    const status = name.endsWith("closeFiscalPeriod") ? "closed" : "open";
    store?.upsertRow("accountingFiscalPeriods", {
      ...(store.getRow("accountingFiscalPeriods", args?.id) ?? byId(accountingFiscalPeriods, args?.id)),
      _id: args?.id,
      status,
      closedAtISO: status === "closed" ? new Date().toISOString() : undefined,
      updatedAtISO: new Date().toISOString(),
    });
    return args?.id;
  }
  if (name === "accounting:upsertJournalEntry" || name === "accounting:postOpeningBalances") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_journal_${Date.now()}`;
    const lines = args?.lines ?? [];
    store?.upsertRow("journalEntries", {
      _id: id,
      societyId: args?.societyId ?? SOCIETY_ID,
      fiscalPeriodId: args?.fiscalPeriodId,
      date: args?.date,
      memo: args?.memo ?? (name.endsWith("postOpeningBalances") ? "Opening balances" : "Manual journal entry"),
      source: args?.source ?? (name.endsWith("postOpeningBalances") ? "opening_balance" : "manual"),
      status: args?.status ?? "posted",
      fiscalYear: args?.fiscalYear,
      createdByUserId: args?.actingUserId,
      postedAtISO: now,
      sourceDocumentIds: args?.sourceDocumentIds,
      createdAtISO: now,
      updatedAtISO: now,
    });
    lines.forEach((line: any, index: number) => {
      store?.upsertRow("journalLines", {
        _id: `static_jline_${Date.now()}_${index}`,
        societyId: args?.societyId ?? SOCIETY_ID,
        journalEntryId: id,
        accountId: line.accountId,
        lineOrder: index,
        amountCents: line.amountCents,
        side: line.side,
        description: line.description,
        fundRestrictionId: line.fundRestrictionId,
        documentIds: args?.sourceDocumentIds,
        createdAtISO: now,
        updatedAtISO: now,
      });
    });
    return id;
  }
  if (name === "accounting:postTransactionCandidateAllocation") {
    const now = new Date().toISOString();
    const candidate = evidenceRegistersOverview.transactionCandidates.find((row: any) => row._id === args?.transactionCandidateId);
    const id = `static_journal_candidate_${Date.now()}`;
    const total = (args?.allocations ?? []).reduce((sum: number, row: any) => sum + row.amountCents, 0);
    store?.upsertRow("journalEntries", {
      _id: id,
      societyId: args?.societyId ?? SOCIETY_ID,
      date: candidate?.transactionDate ?? now.slice(0, 10),
      memo: args?.memo ?? candidate?.description ?? "Posted transaction candidate",
      source: "transactionCandidate",
      status: "posted",
      fiscalYear: args?.fiscalYear,
      createdByUserId: args?.actingUserId,
      postedAtISO: now,
      createdAtISO: now,
      updatedAtISO: now,
    });
    store?.upsertRow("journalLines", {
      _id: `static_jline_candidate_cash_${Date.now()}`,
      societyId: SOCIETY_ID,
      journalEntryId: id,
      accountId: args?.cashAccountId,
      lineOrder: 0,
      amountCents: total,
      side: "credit",
      description: candidate?.description,
      transactionCandidateId: args?.transactionCandidateId,
      createdAtISO: now,
      updatedAtISO: now,
    });
    (args?.allocations ?? []).forEach((line: any, index: number) => {
      store?.upsertRow("journalLines", {
        _id: `static_jline_candidate_alloc_${Date.now()}_${index}`,
        societyId: SOCIETY_ID,
        journalEntryId: id,
        accountId: line.accountId,
        lineOrder: index + 1,
        amountCents: line.amountCents,
        side: "debit",
        description: line.description,
        createdAtISO: now,
        updatedAtISO: now,
      });
    });
    return id;
  }
  if (name === "accounting:createReconciliationRun") {
    const now = new Date().toISOString();
    const seed = staticAccountingSeed(store, args);
    const ledger = staticGeneralLedger(seed, args).filter((line) => line.accountId === args?.financialAccountId && line.entry.date <= args?.statementDate);
    const bookBalanceCents = ledger.reduce((sum, line) => sum + (line.side === "debit" ? line.amountCents : -line.amountCents), 0);
    const differenceCents = (args?.statementBalanceCents ?? 0) - bookBalanceCents;
    const runId = `static_reconciliation_run_${Date.now()}`;
    store?.upsertRow("reconciliationRuns", {
      _id: runId,
      societyId: args?.societyId ?? SOCIETY_ID,
      financialAccountId: args?.financialAccountId,
      statementDate: args?.statementDate,
      statementBalanceCents: args?.statementBalanceCents,
      bookBalanceCents,
      status: differenceCents === 0 ? "ready" : "draft",
      createdAtISO: now,
      updatedAtISO: now,
    });
    return { runId, bookBalanceCents, differenceCents };
  }
  if (name === "accounting:setReconciliationRunStatus") {
    const existing = store?.getRow("reconciliationRuns", args?.id) ?? byId(reconciliationRuns, args?.id);
    store?.upsertRow("reconciliationRuns", {
      ...existing,
      _id: args?.id,
      status: args?.status,
      reconciledAtISO: args?.status === "reconciled" ? new Date().toISOString() : existing?.reconciledAtISO,
      updatedAtISO: new Date().toISOString(),
    });
    return args?.id;
  }
  if (name === "accounting:backfillFinancialTransactionsToJournal") {
    const now = new Date().toISOString();
    const seed = staticAccountingSeed(store, args);
    const existingLines = store?.listRows("journalLines", args) ?? journalLines;
    const alreadyBackfilled = new Set(existingLines.map((line: any) => String(line.financialTransactionId ?? "")));
    const accounts = seed.financialAccounts;
    const accountById = new Map(accounts.map((account: any) => [account._id, account]));
    const fallbackIncome = accounts.find((account: any) => account.accountType === "Income");
    const fallbackExpense = accounts.find((account: any) => account.accountType === "Expense");
    let scanned = 0;
    let posted = 0;
    let skipped = 0;
    let needsMapping = 0;
    for (const transaction of scopedRows(store?.listRows("financialTransactions", args) ?? financialTransactions, args).sort((a, b) => a.date.localeCompare(b.date))) {
      if (posted >= (args?.limit ?? 200)) break;
      scanned += 1;
      if (alreadyBackfilled.has(String(transaction._id))) {
        skipped += 1;
        continue;
      }
      const cashAccount = accountById.get(transaction.accountId);
      const offsetAccount = transaction.amountCents >= 0 ? fallbackIncome : fallbackExpense;
      if (!cashAccount || !offsetAccount || transaction.amountCents === 0) {
        needsMapping += 1;
        continue;
      }
      const amountCents = Math.abs(transaction.amountCents);
      const entryId = `static_journal_backfill_${transaction._id}`;
      store?.upsertRow("journalEntries", {
        _id: entryId,
        societyId: args?.societyId ?? SOCIETY_ID,
        connectionId: transaction.connectionId,
        date: transaction.date,
        memo: transaction.description,
        source: "financialTransactionBackfill",
        sourceExternalId: transaction.externalId,
        status: "posted",
        fiscalYear: args?.fiscalYear,
        createdByUserId: args?.actingUserId,
        postedAtISO: now,
        rawJson: JSON.stringify(transaction),
        createdAtISO: now,
        updatedAtISO: now,
      });
      store?.upsertRow("journalLines", {
        _id: `static_jline_backfill_cash_${transaction._id}`,
        societyId: args?.societyId ?? SOCIETY_ID,
        journalEntryId: entryId,
        accountId: transaction.accountId,
        lineOrder: 0,
        amountCents,
        side: transaction.amountCents >= 0 ? "debit" : "credit",
        description: transaction.description,
        financialTransactionId: transaction._id,
        sourceExternalId: transaction.externalId,
        createdAtISO: now,
        updatedAtISO: now,
      });
      store?.upsertRow("journalLines", {
        _id: `static_jline_backfill_offset_${transaction._id}`,
        societyId: args?.societyId ?? SOCIETY_ID,
        journalEntryId: entryId,
        accountId: offsetAccount._id,
        lineOrder: 1,
        amountCents,
        side: transaction.amountCents >= 0 ? "credit" : "debit",
        description: transaction.category ?? transaction.description,
        financialTransactionId: transaction._id,
        sourceExternalId: transaction.categoryAccountExternalId ?? transaction.externalId,
        createdAtISO: now,
        updatedAtISO: now,
      });
      posted += 1;
    }
    return { scanned, posted, skipped, needsMapping };
  }
  if (name === "seed:run") {
    void store?.reseed();
    return { societyId: SOCIETY_ID };
  }
  if (name === "seed:reset") {
    void store?.reseed();
    return { ok: true };
  }
  if (name === "users:resolveAuthSession") return { userId: USER_OWNER_ID };
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
  if (name === "motionBacklog:seedPipaSetup") {
    return { inserted: 0, existing: motionBacklog.length };
  }
  if (name === "motionBacklog:addToAgenda") {
    return { agendaItemId: "static_agenda_item_motion_backlog", reused: false };
  }
  if (name === "motionBacklog:seedToMinutes") {
    return { inserted: 1, considered: 1, minutesId: "static_minutes_board_q2" };
  }
  if (name === "legalOperations:seedStarterPolicyTemplates") {
    return { inserted: 18, updated: 0, skipped: 0, total: 18 };
  }
  if (name === "documents:markOpened") return { openedAtISO: new Date().toISOString() };
  if (name === "documents:updateReviewStatus") return null;
  if (name === "documentComments:create") return "static_document_comment_new";
  if (name === "documentComments:setStatus") return null;
  if (name === "documentComments:remove") return null;
  return MUT_NOT_HANDLED;
}

function mutCasesMeetings6(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "meetings:markSourceReview") return null;
  if (name === "meetings:setPackageReviewStatus") return null;
  if (name === "meetingMaterials:attach") return "static_material_new";
  if (name === "meetingMaterials:remove") return null;
  if (name === "orgChartAssignments:upsert") return "static_org_chart_assignment";
  if (name === "orgChartAssignments:remove") return null;
  if (name === "expenseReports:upsert") return "static_expense_new";
  if (name === "expenseReports:setStatus") return null;
  if (name === "expenseReports:remove") return null;
  if (name === "documents:createPipaPolicyDraft") {
    return {
      reused: false,
      refreshed: false,
      document: {
        _id: "static_pipa_policy_draft",
        societyId: args?.societyId ?? SOCIETY_ID,
        title: `Draft PIPA privacy policy - ${society.name}`,
        category: "Policy",
        content: staticPipaPolicyDraft(),
        createdAtISO: new Date().toISOString(),
        flaggedForDeletion: false,
        retentionYears: 10,
        tags: ["privacy", "privacy-policy", "pipa", "draft", "societyer-template", "society-filled"],
      },
    };
  }
  if (name === "documents:rebuildPipaPolicyDraftFromSociety") {
    return {
      _id: args?.id ?? "static_pipa_policy_draft",
      societyId: SOCIETY_ID,
      title: `Draft PIPA privacy policy - ${society.name}`,
      category: "Policy",
      content: staticPipaPolicyDraft(),
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      retentionYears: 10,
      tags: ["privacy", "privacy-policy", "pipa", "draft", "societyer-template", "society-filled"],
    };
  }
  return MUT_NOT_HANDLED;
}

function mutCasesDocuments7(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "documents:createMemberDataGapMemoDraft") {
    return {
      reused: false,
      document: {
        _id: "static_member_data_gap_memo_draft",
        societyId: args?.societyId ?? SOCIETY_ID,
        title: `Draft member-data access gap memo - ${society.name}`,
        category: "Policy",
        content: `# ${society.name} Member-Data Access Gap Memo\n\nStatus: Draft\n\nDocument what the society controls, what the university or parent body holds, and what evidence supports that conclusion.\n`,
        createdAtISO: new Date().toISOString(),
        flaggedForDeletion: false,
        retentionYears: 10,
        tags: ["privacy", "member-data-gap", "pipa", "draft", "societyer-template"],
      },
    };
  }
  if (name === "documents:updateDraftContent") {
    return {
      _id: args?.id ?? "static_draft_document",
      societyId: SOCIETY_ID,
      title: args?.title ?? "Draft document",
      category: "Policy",
      content: args?.content ?? "",
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      retentionYears: 10,
      tags: args?.tags ?? ["privacy", "draft"],
    };
  }
  if (name === "documents:linkPrivacyPolicyEvidence") {
    return { documentId: args?.documentId ?? DOCUMENT_POLICY_ID };
  }
  if (name === "dashboardRemediation:createComplianceReviewTask" || name === "dashboardRemediation:createPrivacyReviewTask") {
    return {
      taskId: `static_task_${args?.ruleId ?? "compliance"}`,
      remediationId: `static_remediation_${args?.ruleId ?? "compliance"}`,
      reused: false,
    };
  }
  if (name === "dashboardRemediation:markPrivacyProgramReviewed" || name === "dashboardRemediation:markMemberDataAccessReviewed") {
    return {
      remediationId: `static_remediation_${args?.ruleId ?? "compliance"}`,
      reviewedAtISO: new Date().toISOString(),
    };
  }
  if (name === "commitments:recordEvent") return `static_commitment_event_${Date.now()}`;
  if (name === "commitments:removeEvent") return null;
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
  if (name === "fundingSources:importStudentLevy") {
    return {
      sourceId: "static_student_levy_source",
      fundingSourceAction: "created",
      createdFeePeriods: args?.feePeriods?.length ?? 0,
      updatedFeePeriods: 0,
    };
  }
  if (name === "grantSources:addFromLibrary") {
    const librarySource = BUILT_IN_GRANT_SOURCES.find((source) => source.libraryKey === args?.libraryKey);
    if (!librarySource) return { sourceId: "static_grant_source_unknown", installed: false };
    const { profile: _profile, ...sourcePayload } = librarySource;
    const now = new Date().toISOString();
    let source = tables.grantSources.find((row) => row.libraryKey === librarySource.libraryKey);
    if (source) {
      Object.assign(source, {
        ...sourcePayload,
        societyId: args?.societyId ?? SOCIETY_ID,
        updatedAtISO: now,
      });
    } else {
      source = {
        _id: `static_grant_source_${librarySource.libraryKey}`,
        _creationTime: Date.now(),
        societyId: args?.societyId ?? SOCIETY_ID,
        ...sourcePayload,
        createdByUserId: args?.actingUserId,
        createdAtISO: now,
        updatedAtISO: now,
      };
      tables.grantSources.push(source);
    }
    const libraryProfile = BUILT_IN_GRANT_SOURCE_PROFILES.find((profile) => profile.libraryKey === librarySource.libraryKey);
    if (libraryProfile) {
      const existingProfile = tables.grantSourceProfiles.find((profile) => profile.sourceId === source._id || profile.libraryKey === librarySource.libraryKey);
      const profilePayload = {
        societyId: args?.societyId ?? SOCIETY_ID,
        sourceId: source._id,
        ...libraryProfile,
        updatedAtISO: now,
      };
      if (existingProfile) {
        Object.assign(existingProfile, profilePayload);
      } else {
        tables.grantSourceProfiles.push({
          _id: `static_grant_source_profile_${librarySource.libraryKey}`,
          _creationTime: Date.now(),
          ...profilePayload,
          createdAtISO: now,
        });
      }
    }
    return { sourceId: source._id, installed: true };
  }
  if (name === "inventoryHub:postStockMovement") {
    const now = new Date().toISOString();
    const movement = {
      _id: `static_stock_movement_manual_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      movementDate: args?.movementDate ?? now.slice(0, 10),
      movementType: args?.movementType ?? "receive",
      status: args?.status ?? "posted",
      inventoryItemId: args?.inventoryItemId,
      inventoryLotId: args?.inventoryLotId,
      fromLocationId: args?.fromLocationId,
      toLocationId: args?.toLocationId,
      quantity: Number(args?.quantity ?? 0),
      unitOfMeasure: args?.unitOfMeasure ?? "each",
      unitCostCents: args?.unitCostCents,
      totalCostCents: args?.totalCostCents,
      reason: args?.reason,
      reference: args?.reference,
      sourceExternalId: args?.sourceExternalId,
      sourceSystem: args?.sourceSystem ?? "societyer_manual",
      documentIds: args?.documentIds ?? [],
      rawJson: args?.rawJson,
      createdAtISO: now,
      updatedAtISO: now,
    };
    // Mirror the Convex guard: don't let a posted movement drive a source
    // balance negative. Internal callers (backfill/count/import) pass
    // skipStockCheck since on the Convex side they bypass this mutation.
    if (!args?.skipStockCheck && movement.status === "posted" && movement.fromLocationId) {
      const balances = store?.listRows("inventoryBalances", { societyId: movement.societyId }) ?? tables.inventoryBalances;
      const balance = balances.find((row: any) =>
        row.inventoryItemId === movement.inventoryItemId && row.locationId === movement.fromLocationId && String(row.inventoryLotId ?? "") === String(movement.inventoryLotId ?? "")
      );
      const onHand = balance?.quantityOnHand ?? 0;
      const want = Number(movement.quantity ?? 0);
      if (onHand - want < 0) {
        throw new Error(`Not enough stock at the source location: ${onHand} on hand, tried to remove ${want}.`);
      }
    }
    store?.upsertRow("stockMovements", movement);
    const applyDelta = (locationId: string | undefined, delta: number) => {
      if (!locationId || delta === 0) return;
      const balances = store?.listRows("inventoryBalances", { societyId: movement.societyId }) ?? tables.inventoryBalances;
      const balance = balances.find((row: any) =>
        row.inventoryItemId === movement.inventoryItemId && row.locationId === locationId && String(row.inventoryLotId ?? "") === String(movement.inventoryLotId ?? "")
      );
      if (balance) {
        const quantityOnHand = (balance.quantityOnHand ?? 0) + delta;
        const quantityReserved = balance.quantityReserved ?? 0;
        store?.upsertRow("inventoryBalances", {
          ...balance,
          quantityOnHand,
          quantityAvailable: quantityOnHand - quantityReserved,
          lastMovementId: movement._id,
          ...(movement.movementType === "count" ? { lastCountedAtISO: now } : {}),
          updatedAtISO: now,
        });
      } else {
        store?.upsertRow("inventoryBalances", {
          _id: `static_inventory_balance_${Date.now()}_${locationId}`,
          societyId: movement.societyId,
          inventoryItemId: movement.inventoryItemId,
          inventoryLotId: movement.inventoryLotId,
          locationId,
          quantityOnHand: delta,
          quantityReserved: 0,
          quantityAvailable: delta,
          lastMovementId: movement._id,
          ...(movement.movementType === "count" ? { lastCountedAtISO: now } : {}),
          createdAtISO: now,
          updatedAtISO: now,
        });
      }
    };
    const quantity = Number(movement.quantity ?? 0);
    if (movement.fromLocationId) applyDelta(movement.fromLocationId, -quantity);
    if (movement.toLocationId) applyDelta(movement.toLocationId, quantity);
    if (!movement.fromLocationId && !movement.toLocationId) throw new Error("Stock movement needs a source or destination location.");
    return movement._id;
  }
  if (name === "inventoryHub:upsertItem") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_inventory_item_manual_${Date.now()}`;
    const existing = store?.getRow("inventoryItems", id) ?? byId(tables.inventoryItems, id) ?? {};
    const row = {
      ...existing,
      _id: id,
      societyId: args?.societyId ?? existing.societyId ?? SOCIETY_ID,
      connectionId: args?.connectionId ?? existing.connectionId,
      sku: args?.sku ?? existing.sku,
      name: args?.name ?? existing.name,
      description: args?.description ?? existing.description,
      category: args?.category ?? existing.category ?? "Uncategorized",
      itemType: args?.itemType ?? existing.itemType ?? "supply",
      unitOfMeasure: args?.unitOfMeasure ?? existing.unitOfMeasure ?? "each",
      defaultCostCents: args?.defaultCostCents ?? existing.defaultCostCents,
      currency: args?.currency ?? existing.currency ?? "CAD",
      trackSerial: args?.trackSerial ?? existing.trackSerial ?? false,
      trackLot: args?.trackLot ?? existing.trackLot ?? false,
      trackExpiry: args?.trackExpiry ?? existing.trackExpiry ?? false,
      reorderPoint: args?.reorderPoint ?? existing.reorderPoint,
      status: args?.status ?? existing.status ?? "active",
      assetId: args?.assetId ?? existing.assetId,
      imageStorageId: args?.imageStorageId,
      imageUrl: args?.imageUrl,
      sourceSystem: args?.sourceSystem ?? existing.sourceSystem ?? "manual",
      createdAtISO: existing.createdAtISO ?? now,
      updatedAtISO: now,
    };
    store?.upsertRow("inventoryItems", row);
    return id;
  }
  if (name === "inventoryHub:upsertLocation") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_inventory_location_manual_${Date.now()}`;
    const existing = store?.getRow("inventoryLocations", id) ?? byId(tables.inventoryLocations, id) ?? {};
    const row = {
      ...existing,
      _id: id,
      societyId: args?.societyId ?? existing.societyId ?? SOCIETY_ID,
      connectionId: args?.connectionId ?? existing.connectionId,
      name: args?.name ?? existing.name,
      code: args?.code ?? existing.code,
      locationType: args?.locationType ?? existing.locationType ?? "facility",
      parentLocationId: args?.parentLocationId ?? existing.parentLocationId,
      address: args?.address ?? existing.address,
      notes: args?.notes ?? existing.notes,
      active: args?.active ?? existing.active ?? true,
      sourceSystem: args?.sourceSystem ?? existing.sourceSystem ?? "manual",
      createdAtISO: existing.createdAtISO ?? now,
      updatedAtISO: now,
    };
    store?.upsertRow("inventoryLocations", row);
    return id;
  }
  if (name === "inventoryHub:deleteLocation") {
    const balances = (store?.listRows("inventoryBalances", {}) ?? tables.inventoryBalances).filter((row: any) => row.locationId === args?.id);
    if (balances.some((row: any) => (row.quantityOnHand ?? 0) !== 0)) {
      throw new Error("Move or zero out this location's stock before deleting it.");
    }
    const children = (store?.listRows("inventoryLocations", {}) ?? tables.inventoryLocations).filter((row: any) => row.parentLocationId === args?.id);
    if (children.length > 0) {
      throw new Error("Re-parent or delete the locations nested inside this one first.");
    }
    for (const row of balances) store?.removeRow("inventoryBalances", row._id);
    store?.removeRow("inventoryLocations", args?.id);
    return { deleted: true };
  }
  if (name === "inventoryHub:deleteItem") {
    const movements = (store?.listRows("stockMovements", {}) ?? tables.stockMovements).filter((row: any) => row.inventoryItemId === args?.id);
    if (movements.length > 0) {
      throw new Error("This item has stock movement history. Archive it instead of deleting.");
    }
    for (const row of (store?.listRows("inventoryBalances", {}) ?? tables.inventoryBalances).filter((b: any) => b.inventoryItemId === args?.id)) {
      store?.removeRow("inventoryBalances", row._id);
    }
    for (const row of (store?.listRows("inventoryLots", {}) ?? tables.inventoryLots).filter((l: any) => l.inventoryItemId === args?.id)) {
      store?.removeRow("inventoryLots", row._id);
    }
    store?.removeRow("inventoryItems", args?.id);
    return { deleted: true };
  }
  if (name === "inventoryHub:upsertLot") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_inventory_lot_${Date.now()}`;
    const existing = store?.getRow("inventoryLots", id) ?? byId(tables.inventoryLots, id) ?? {};
    store?.upsertRow("inventoryLots", {
      ...existing,
      _id: id,
      societyId: args?.societyId ?? existing.societyId ?? SOCIETY_ID,
      inventoryItemId: args?.inventoryItemId ?? existing.inventoryItemId,
      lotNumber: args?.lotNumber ?? existing.lotNumber,
      serialNumber: args?.serialNumber ?? existing.serialNumber,
      expiresAt: args?.expiresAt ?? existing.expiresAt,
      manufacturer: args?.manufacturer ?? existing.manufacturer,
      manufacturedAt: args?.manufacturedAt ?? existing.manufacturedAt,
      condition: args?.condition ?? existing.condition,
      status: args?.status ?? existing.status ?? "active",
      assetId: args?.assetId ?? existing.assetId,
      sourceSystem: args?.sourceSystem ?? existing.sourceSystem ?? "manual",
      createdAtISO: existing.createdAtISO ?? now,
      updatedAtISO: now,
    });
    return id;
  }
  if (name === "inventoryHub:deleteLot") {
    const movements = (store?.listRows("stockMovements", {}) ?? tables.stockMovements).filter((row: any) => row.inventoryLotId === args?.id);
    if (movements.length > 0) throw new Error("This lot has stock movement history and can't be deleted.");
    store?.removeRow("inventoryLots", args?.id);
    return { deleted: true };
  }
  if (name === "inventoryHub:createCount") {
    const now = new Date().toISOString();
    const societyId = args?.societyId ?? SOCIETY_ID;
    const countId = `static_inventory_count_${Date.now()}`;
    const scope = args?.locationId ? "location" : args?.itemType ? args.itemType : "all";
    store?.upsertRow("inventoryCounts", {
      _id: countId,
      societyId,
      title: args?.title ?? "Physical count",
      status: "open",
      startedAtISO: now,
      reviewerName: args?.reviewerName,
      locationId: args?.locationId,
      scope,
      sourceDocumentIds: [],
      notes: args?.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    const items = store?.listRows("inventoryItems", { societyId }) ?? scopedRows(tables.inventoryItems, { societyId });
    const itemsById = new Map(items.map((row: any) => [String(row._id), row]));
    const balances = store?.listRows("inventoryBalances", { societyId }) ?? scopedRows(tables.inventoryBalances, { societyId });
    let lines = 0;
    for (const balance of balances) {
      if (args?.locationId && String(balance.locationId) !== String(args.locationId)) continue;
      const item: any = itemsById.get(String(balance.inventoryItemId));
      if (!item) continue;
      if (args?.itemType && item.itemType !== args.itemType) continue;
      store?.upsertRow("inventoryCountLines", {
        _id: `static_inventory_count_line_${Date.now()}_${lines}`,
        societyId,
        inventoryCountId: countId,
        inventoryItemId: balance.inventoryItemId,
        inventoryLotId: balance.inventoryLotId,
        locationId: balance.locationId,
        expectedQuantity: balance.quantityOnHand ?? 0,
        status: "pending",
        createdAtISO: now,
        updatedAtISO: now,
      });
      lines += 1;
    }
    return { countId, lines };
  }
  if (name === "inventoryHub:addCountLine") {
    const now = new Date().toISOString();
    const count = store?.getRow("inventoryCounts", args?.inventoryCountId) ?? byId(tables.inventoryCounts, args?.inventoryCountId);
    const id = `static_inventory_count_line_${Date.now()}`;
    store?.upsertRow("inventoryCountLines", {
      _id: id,
      societyId: count?.societyId ?? SOCIETY_ID,
      inventoryCountId: args?.inventoryCountId,
      inventoryItemId: args?.inventoryItemId,
      inventoryLotId: args?.inventoryLotId,
      locationId: args?.locationId,
      expectedQuantity: 0,
      countedQuantity: args?.countedQuantity,
      varianceQuantity: args?.countedQuantity != null ? args.countedQuantity : undefined,
      condition: args?.condition,
      status: args?.countedQuantity != null ? "counted" : "pending",
      notes: args?.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    return id;
  }
  if (name === "inventoryHub:setCountLine") {
    const now = new Date().toISOString();
    const line = store?.getRow("inventoryCountLines", args?.id) ?? byId(tables.inventoryCountLines, args?.id);
    if (!line) throw new Error("Count line not found.");
    const countedQuantity = args?.countedQuantity ?? line.countedQuantity;
    store?.upsertRow("inventoryCountLines", {
      ...line,
      countedQuantity,
      varianceQuantity: countedQuantity != null ? countedQuantity - (line.expectedQuantity ?? 0) : line.varianceQuantity,
      condition: args?.condition ?? line.condition,
      status: args?.status ?? (countedQuantity != null ? "counted" : line.status),
      notes: args?.notes ?? line.notes,
      updatedAtISO: now,
    });
    return args?.id;
  }
  if (name === "inventoryHub:voidCount") {
    const now = new Date().toISOString();
    const count = store?.getRow("inventoryCounts", args?.inventoryCountId) ?? byId(tables.inventoryCounts, args?.inventoryCountId);
    if (count) store?.upsertRow("inventoryCounts", { ...count, status: "void", completedAtISO: now, updatedAtISO: now });
    return { voided: true };
  }
  if (name === "inventoryHub:linkReceipt") {
    const now = new Date().toISOString();
    let assetId = args?.assetId;
    if (!assetId && args?.inventoryItemId) {
      const item = store?.getRow("inventoryItems", args.inventoryItemId) ?? byId(tables.inventoryItems, args.inventoryItemId);
      assetId = item?.assetId;
    }
    const id = args?.id ?? `static_asset_receipt_link_${Date.now()}`;
    const existing = store?.getRow("assetReceiptLinks", id) ?? {};
    store?.upsertRow("assetReceiptLinks", {
      ...existing,
      _id: id,
      societyId: args?.societyId ?? existing.societyId ?? SOCIETY_ID,
      assetId,
      inventoryItemId: args?.inventoryItemId,
      receiptDocumentId: args?.receiptDocumentId,
      financialTransactionId: args?.financialTransactionId,
      receiptLineLabel: args?.receiptLineLabel,
      receiptLineIndex: args?.receiptLineIndex,
      quantity: args?.quantity,
      unitOfMeasure: args?.unitOfMeasure,
      unitCostCents: args?.unitCostCents,
      totalCostCents: args?.totalCostCents,
      sourceText: args?.sourceText,
      notes: args?.notes,
      createdByUserId: args?.createdByUserId,
      createdAtISO: existing.createdAtISO ?? now,
      updatedAtISO: now,
    });
    if (assetId) {
      const asset = store?.getRow("assets", assetId) ?? byId(tables.assets, assetId);
      if (asset) {
        store?.upsertRow("assets", {
          ...asset,
          receiptDocumentId: asset.receiptDocumentId ?? args?.receiptDocumentId,
          purchaseTransactionId: asset.purchaseTransactionId ?? args?.financialTransactionId,
          sourceDocumentIds: Array.from(new Set([...(asset.sourceDocumentIds ?? []), args?.receiptDocumentId].filter(Boolean))),
          updatedAtISO: now,
        });
      }
    }
    return id;
  }
  if (name === "inventoryHub:unlinkReceipt") {
    store?.removeRow("assetReceiptLinks", args?.id);
    return { deleted: true };
  }
  if (name === "inventoryHub:backfillAssets") {
    const now = new Date().toISOString();
    const assets = store?.listRows("assets", args) ?? scopedRows(tables.assets, args);
    let itemsCreated = 0;
    let locationsCreated = 0;
    let movementsCreated = 0;
    let balancesCreated = 0;
    for (const asset of assets) {
      let item = (store?.listRows("inventoryItems", { societyId: asset.societyId }) ?? tables.inventoryItems).find((row: any) => row.assetId === asset._id);
      if (!item) {
        item = {
          _id: `static_inventory_item_${asset._id}_${Date.now()}`,
          societyId: asset.societyId,
          sku: asset.assetTag,
          name: asset.name,
          category: asset.category,
          itemType: asset.category === "Consumable" ? "consumable" : "asset",
          unitOfMeasure: asset.quantityUnit ?? "each",
          currency: asset.currency ?? "CAD",
          trackSerial: Boolean(asset.serialNumber),
          trackLot: false,
          trackExpiry: false,
          status: "active",
          assetId: asset._id,
          sourceSystem: "societyer_assets",
          createdAtISO: now,
          updatedAtISO: now,
        };
        store?.upsertRow("inventoryItems", item);
        itemsCreated += 1;
      }
      const locationName = String(asset.location ?? asset.custodianName ?? "Inventory").trim() || "Inventory";
      let location = (store?.listRows("inventoryLocations", { societyId: asset.societyId }) ?? tables.inventoryLocations).find((row: any) => row.name === locationName);
      if (!location) {
        location = {
          _id: `static_inventory_location_${Date.now()}_${asset._id}`,
          societyId: asset.societyId,
          name: locationName,
          locationType: asset.location ? "facility" : "virtual",
          active: true,
          sourceSystem: "societyer_assets",
          createdAtISO: now,
          updatedAtISO: now,
        };
        store?.upsertRow("inventoryLocations", location);
        locationsCreated += 1;
      }
      const existingMovement = (store?.listRows("stockMovements", { societyId: asset.societyId }) ?? tables.stockMovements).find((row: any) => row.inventoryItemId === item._id);
      if (existingMovement) continue;
      const quantity = asset.category === "Consumable" ? asset.quantityOnHand ?? 0 : asset.status === "Disposed" || asset.status === "Lost" ? 0 : 1;
      if (quantity <= 0) continue;
      mutationResult("inventoryHub:postStockMovement", {
        societyId: asset.societyId,
        movementDate: asset.purchaseDate ?? now.slice(0, 10),
        movementType: "receive",
        inventoryItemId: item._id,
        toLocationId: location._id,
        quantity,
        unitOfMeasure: item.unitOfMeasure,
        reason: "Backfilled from Societyer asset register",
        reference: asset.assetTag,
        sourceSystem: "societyer_assets",
        skipStockCheck: true,
      }, store);
      movementsCreated += 1;
      balancesCreated += 1;
    }
    return { itemsCreated, locationsCreated, movementsCreated, balancesCreated };
  }
  if (name === "inventoryHub:postCountVarianceAdjustments") {
    const now = new Date().toISOString();
    const count = store?.getRow("inventoryCounts", args?.inventoryCountId) ?? byId(tables.inventoryCounts, args?.inventoryCountId);
    if (!count) return { adjusted: 0 };
    const lines = (store?.listRows("inventoryCountLines", { societyId: count.societyId }) ?? tables.inventoryCountLines).filter((line: any) => line.inventoryCountId === count._id);
    let adjusted = 0;
    for (const line of lines) {
      if (line.adjustmentMovementId || line.countedQuantity == null || line.expectedQuantity == null) continue;
      const variance = line.countedQuantity - line.expectedQuantity;
      if (variance === 0) continue;
      const movementId = mutationResult("inventoryHub:postStockMovement", {
        societyId: count.societyId,
        movementDate: now.slice(0, 10),
        movementType: "adjustment",
        inventoryItemId: line.inventoryItemId,
        fromLocationId: variance < 0 ? line.locationId : undefined,
        toLocationId: variance > 0 ? line.locationId : undefined,
        quantity: Math.abs(variance),
        unitOfMeasure: "each",
        reason: args?.reason ?? `Physical count variance: ${count.title}`,
        reference: count.title,
        sourceSystem: "societyer_count",
        skipStockCheck: true,
      }, store);
      store?.upsertRow("inventoryCountLines", { ...line, varianceQuantity: variance, adjustmentMovementId: movementId, status: "adjusted", updatedAtISO: now });
      adjusted += 1;
    }
    store?.upsertRow("inventoryCounts", { ...count, status: "completed", completedAtISO: count.completedAtISO ?? now, updatedAtISO: now });
    return { adjusted };
  }
  if (name === "inventoryHub:importOpenBoxesSnapshot") {
    const now = new Date().toISOString();
    const connectionId = args?.connectionId ?? "static_inventory_connection_openboxes";
    store?.upsertRow("inventoryConnections", {
      _id: connectionId,
      societyId: args?.societyId ?? SOCIETY_ID,
      provider: "openboxes",
      displayName: "OpenBoxes",
      status: "active",
      lastSyncedAtISO: now,
      createdAtISO: now,
      updatedAtISO: now,
    });
    let itemsUpserted = 0;
    let locationsUpserted = 0;
    let movementsPosted = 0;
    for (const product of args?.products ?? []) {
      store?.upsertRow("inventoryItems", {
        _id: `static_openboxes_item_${product.id}`,
        societyId: args?.societyId ?? SOCIETY_ID,
        connectionId,
        sku: product.productCode,
        name: product.name,
        category: product.category ?? "OpenBoxes",
        itemType: "supply",
        unitOfMeasure: product.unitOfMeasure ?? "each",
        currency: "CAD",
        trackSerial: Boolean(product.serialized),
        trackLot: Boolean(product.lotAndExpiryControl),
        trackExpiry: Boolean(product.lotAndExpiryControl),
        status: "active",
        externalId: product.id,
        sourceSystem: "openboxes",
        rawJson: product.rawJson,
        createdAtISO: now,
        updatedAtISO: now,
      });
      itemsUpserted += 1;
    }
    for (const location of args?.locations ?? []) {
      store?.upsertRow("inventoryLocations", {
        _id: `static_openboxes_location_${location.id}`,
        societyId: args?.societyId ?? SOCIETY_ID,
        connectionId,
        name: location.name,
        locationType: location.locationType ?? "facility",
        active: true,
        externalId: location.id,
        sourceSystem: "openboxes",
        rawJson: location.rawJson,
        createdAtISO: now,
        updatedAtISO: now,
      });
      locationsUpserted += 1;
    }
    for (const movement of args?.movements ?? []) {
      const itemId = `static_openboxes_item_${movement.productId}`;
      const fromLocationId = movement.originLocationId ? `static_openboxes_location_${movement.originLocationId}` : undefined;
      const toLocationId = movement.destinationLocationId ? `static_openboxes_location_${movement.destinationLocationId}` : undefined;
      mutationResult("inventoryHub:postStockMovement", {
        societyId: args?.societyId ?? SOCIETY_ID,
        movementDate: movement.date,
        movementType: movement.type,
        inventoryItemId: itemId,
        fromLocationId,
        toLocationId,
        quantity: movement.quantity,
        unitOfMeasure: movement.unitOfMeasure ?? "each",
        reason: movement.reason,
        sourceExternalId: movement.id,
        sourceSystem: "openboxes",
        rawJson: movement.rawJson,
        skipStockCheck: true,
      }, store);
      movementsPosted += 1;
    }
    return { connectionId, itemsUpserted, locationsUpserted, movementsPosted };
  }
  if (name === "society:updateInventorySettings") {
    const societyId = args?.societyId ?? SOCIETY_ID;
    const existing = store?.getRow("societies", societyId) ?? society;
    store?.upsertRow("societies", {
      ...existing,
      _id: societyId,
      consumableIntakeCountPromptEnabled: Boolean(args?.consumableIntakeCountPromptEnabled),
      updatedAt: Date.now(),
    });
    return societyId;
  }
  if (name === "assets:addConsumableStock") {
    const asset = store?.getRow("assets", args?.assetId) ?? byId(tables.assets, args?.assetId);
    if (!asset) return null;
    if (asset.category !== "Consumable") throw new Error("Stock intake can only be recorded for consumable items.");
    const observedQuantityBefore = Number(args?.observedQuantityBefore);
    const quantityAdded = Number(args?.quantityAdded);
    if (!Number.isFinite(observedQuantityBefore) || observedQuantityBefore < 0 || !Number.isFinite(quantityAdded) || quantityAdded < 0) {
      throw new Error("Consumable quantities cannot be negative.");
    }
    const now = new Date().toISOString();
    const quantityAfter = observedQuantityBefore + quantityAdded;
    const event = {
      _id: `static_asset_event_stock_intake_${Date.now()}`,
      societyId: asset.societyId,
      assetId: asset._id,
      eventType: "stock_intake",
      happenedAtISO: now,
      condition: asset.condition,
      observedQuantityBefore,
      quantityAdded,
      quantityAfter,
      documentIds: [],
      notes: args?.notes,
      createdAtISO: now,
    };
    store?.upsertRow("assetEvents", event);
    const existingItems = store?.listRows("inventoryItems", { societyId: asset.societyId }) ?? tables.inventoryItems;
    let inventoryItem = existingItems.find((row: any) => row.assetId === asset._id);
    if (!inventoryItem) {
      inventoryItem = {
        _id: `static_inventory_item_${asset._id}_${Date.now()}`,
        societyId: asset.societyId,
        sku: asset.assetTag,
        name: asset.name,
        description: asset.notes,
        category: asset.category,
        itemType: asset.category === "Consumable" ? "consumable" : "asset",
        unitOfMeasure: asset.quantityUnit ?? "each",
        defaultCostCents: asset.purchaseValueCents,
        currency: asset.currency ?? "CAD",
        trackSerial: Boolean(asset.serialNumber),
        trackLot: false,
        trackExpiry: false,
        status: asset.status === "Disposed" ? "archived" : "active",
        assetId: asset._id,
        sourceSystem: "societyer_assets",
        createdAtISO: now,
        updatedAtISO: now,
      };
      store?.upsertRow("inventoryItems", inventoryItem);
    }
    const locationName = String(asset.location ?? asset.custodianName ?? "Inventory").trim() || "Inventory";
    const existingLocations = store?.listRows("inventoryLocations", { societyId: asset.societyId }) ?? tables.inventoryLocations;
    let location = existingLocations.find((row: any) => row.name.toLowerCase() === locationName.toLowerCase());
    if (!location) {
      location = {
        _id: `static_inventory_location_${Date.now()}`,
        societyId: asset.societyId,
        name: locationName,
        locationType: asset.location ? "facility" : "virtual",
        active: true,
        sourceSystem: "societyer_assets",
        createdAtISO: now,
        updatedAtISO: now,
      };
      store?.upsertRow("inventoryLocations", location);
    }
    const movement = {
      _id: `static_stock_movement_${Date.now()}`,
      societyId: asset.societyId,
      movementDate: now.slice(0, 10),
      movementType: "receive",
      status: "posted",
      inventoryItemId: inventoryItem._id,
      toLocationId: location._id,
      quantity: quantityAdded,
      unitOfMeasure: asset.quantityUnit ?? "each",
      reference: asset.assetTag,
      sourceSystem: "societyer_assets",
      assetEventId: event._id,
      purchaseTransactionId: asset.purchaseTransactionId,
      receiptDocumentId: asset.receiptDocumentId,
      grantId: asset.grantId,
      documentIds: asset.sourceDocumentIds ?? [],
      rawJson: JSON.stringify({ observedQuantityBefore, quantityAdded }),
      createdAtISO: now,
      updatedAtISO: now,
    };
    store?.upsertRow("stockMovements", movement);
    const existingBalances = store?.listRows("inventoryBalances", { societyId: asset.societyId }) ?? tables.inventoryBalances;
    const balance = existingBalances.find((row: any) =>
      row.inventoryItemId === inventoryItem._id && row.locationId === location._id && !row.inventoryLotId
    );
    if (balance) {
      const quantityOnHand = (balance.quantityOnHand ?? 0) + quantityAdded;
      const quantityReserved = balance.quantityReserved ?? 0;
      store?.upsertRow("inventoryBalances", {
        ...balance,
        quantityOnHand,
        quantityAvailable: quantityOnHand - quantityReserved,
        lastMovementId: movement._id,
        updatedAtISO: now,
      });
    } else {
      store?.upsertRow("inventoryBalances", {
        _id: `static_inventory_balance_${Date.now()}`,
        societyId: asset.societyId,
        inventoryItemId: inventoryItem._id,
        locationId: location._id,
        quantityOnHand: quantityAdded,
        quantityReserved: 0,
        quantityAvailable: quantityAdded,
        lastMovementId: movement._id,
        createdAtISO: now,
        updatedAtISO: now,
      });
    }
    store?.upsertRow("assets", { ...asset, quantityOnHand: quantityAfter, updatedAtISO: now });
    store?.upsertRow("activity", {
      _id: `static_activity_asset_stock_intake_${Date.now()}`,
      societyId: asset.societyId,
      actor: "You",
      entityType: "asset",
      entityId: asset._id,
      action: "stock_intake",
      summary: `Added ${quantityAdded} ${asset.quantityUnit ?? "unit"}${quantityAdded === 1 ? "" : "s"} to ${asset.assetTag}; ${quantityAfter} now on hand`,
      createdAtISO: now,
    });
    return event._id;
  }
  if (name === "assets:linkReceiptLine") {
    const asset = store?.getRow("assets", args?.assetId) ?? byId(tables.assets, args?.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    let inventoryItemId;
    if (args?.createInventoryItem) {
      let inventoryItem = (store?.listRows("inventoryItems", { societyId: asset.societyId }) ?? tables.inventoryItems)
        .find((row: any) => row.assetId === asset._id);
      if (!inventoryItem) {
        inventoryItem = {
          _id: `static_inventory_item_${asset._id}_${Date.now()}`,
          societyId: asset.societyId,
          sku: asset.assetTag,
          name: asset.name,
          description: asset.notes,
          category: asset.category,
          itemType: asset.category === "Consumable" ? "consumable" : "asset",
          unitOfMeasure: asset.quantityUnit ?? args?.unitOfMeasure ?? "each",
          defaultCostCents: asset.purchaseValueCents,
          currency: asset.currency ?? "CAD",
          trackSerial: Boolean(asset.serialNumber),
          trackLot: false,
          trackExpiry: false,
          status: asset.status === "Disposed" ? "archived" : "active",
          assetId: asset._id,
          sourceSystem: "societyer_assets",
          createdAtISO: now,
          updatedAtISO: now,
        };
        store?.upsertRow("inventoryItems", inventoryItem);
      }
      inventoryItemId = inventoryItem._id;
    }
    const linkId = `static_asset_receipt_link_${Date.now()}`;
    store?.upsertRow("assetReceiptLinks", {
      _id: linkId,
      societyId: args?.societyId ?? asset.societyId,
      assetId: asset._id,
      inventoryItemId,
      receiptDocumentId: args?.receiptDocumentId,
      financialTransactionId: args?.financialTransactionId,
      receiptLineLabel: args?.receiptLineLabel,
      receiptLineIndex: args?.receiptLineIndex,
      quantity: args?.quantity,
      unitOfMeasure: args?.unitOfMeasure,
      unitCostCents: args?.unitCostCents,
      totalCostCents: args?.totalCostCents,
      sourceText: args?.sourceText,
      notes: args?.notes,
      createdByUserId: args?.actingUserId,
      createdAtISO: now,
      updatedAtISO: now,
    });
    store?.upsertRow("assets", {
      ...asset,
      receiptDocumentId: asset.receiptDocumentId ?? args?.receiptDocumentId,
      purchaseTransactionId: asset.purchaseTransactionId ?? args?.financialTransactionId,
      sourceDocumentIds: Array.from(new Set([...(asset.sourceDocumentIds ?? []), args?.receiptDocumentId].filter(Boolean))),
      updatedAtISO: now,
    });
    store?.upsertRow("assetEvents", {
      _id: `static_asset_event_receipt_link_${Date.now()}`,
      societyId: asset.societyId,
      assetId: asset._id,
      eventType: "receipt_link",
      happenedAtISO: now,
      documentIds: [args?.receiptDocumentId].filter(Boolean),
      notes: [args?.receiptLineLabel, args?.notes].filter(Boolean).join(" — "),
      createdAtISO: now,
    });
    return { linkId, inventoryItemId };
  }
  if (name === "assets:recordEvent") {
    const asset = store?.getRow("assets", args?.assetId) ?? byId(tables.assets, args?.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    const event = {
      _id: `static_asset_event_${Date.now()}`,
      societyId: asset.societyId,
      assetId: asset._id,
      eventType: args?.event?.eventType ?? "note",
      happenedAtISO: now,
      actorName: args?.event?.actorName,
      fromCustodianName: asset.custodianName,
      toCustodianType: args?.event?.toCustodianType,
      toCustodianName: args?.event?.toCustodianName,
      responsiblePersonName: args?.event?.responsiblePersonName,
      location: args?.event?.location,
      condition: args?.event?.condition,
      expectedReturnDate: args?.event?.expectedReturnDate,
      acceptanceSignature: args?.event?.acceptanceSignature,
      documentIds: args?.event?.documentIds ?? [],
      notes: args?.event?.notes,
      createdAtISO: now,
    };
    store?.upsertRow("assetEvents", event);
    const patch: any = { updatedAtISO: now };
    if (event.eventType === "checkout" || event.eventType === "transfer") {
      patch.status = "Checked out";
      patch.custodianType = event.toCustodianType;
      patch.custodianName = event.toCustodianName;
      patch.responsiblePersonName = event.responsiblePersonName || event.toCustodianName;
      patch.expectedReturnDate = event.expectedReturnDate;
    }
    if (event.eventType === "checkin") {
      patch.status = "Available";
      patch.custodianType = "location";
      patch.custodianName = event.location;
      patch.expectedReturnDate = undefined;
    }
    if (event.location) patch.location = event.location;
    if (event.condition) patch.condition = event.condition;
    store?.upsertRow("assets", { ...asset, ...patch });
    return event._id;
  }
  return MUT_NOT_HANDLED;
}

function mutCasesAssets9(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null): any {
  if (name === "assets:scheduleMaintenance") {
    const asset = store?.getRow("assets", args?.assetId) ?? byId(tables.assets, args?.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    const row = {
      _id: `static_asset_maintenance_${Date.now()}`,
      societyId: asset.societyId,
      assetId: asset._id,
      title: args?.title,
      kind: args?.kind,
      dueDate: args?.dueDate,
      status: "Scheduled",
      notes: args?.notes,
      createdAtISO: now,
      updatedAtISO: now,
    };
    store?.upsertRow("assetMaintenance", row);
    store?.upsertRow("assets", { ...asset, nextMaintenanceDate: args?.dueDate, updatedAtISO: now });
    return row._id;
  }
  if (name === "assets:completeMaintenance") {
    const row = store?.getRow("assetMaintenance", args?.id) ?? byId(tables.assetMaintenance, args?.id);
    if (!row) return null;
    const now = new Date().toISOString();
    store?.upsertRow("assetMaintenance", { ...row, status: "Completed", completedAtISO: args?.completedAtISO ?? now, notes: args?.notes ?? row.notes, updatedAtISO: now });
    return args?.id;
  }
  if (name === "assets:startVerificationRun") {
    const now = new Date().toISOString();
    const assets = store?.listRows("assets", args) ?? scopedRows(tables.assets, args);
    const runId = `static_asset_verification_${Date.now()}`;
    const inventoryCountId = `static_inventory_count_${Date.now()}`;
    store?.upsertRow("assetVerificationRuns", {
      _id: runId,
      societyId: args?.societyId ?? SOCIETY_ID,
      title: args?.title,
      status: "Open",
      startedAtISO: now,
      reviewerName: args?.reviewerName,
      notes: args?.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    store?.upsertRow("inventoryCounts", {
      _id: inventoryCountId,
      societyId: args?.societyId ?? SOCIETY_ID,
      title: args?.title,
      status: "open",
      startedAtISO: now,
      reviewerName: args?.reviewerName,
      scope: "assets",
      sourceDocumentIds: [],
      notes: args?.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    assets.forEach((asset: any) => {
      const existingItems = store?.listRows("inventoryItems", { societyId: asset.societyId }) ?? tables.inventoryItems;
      let inventoryItem = existingItems.find((row: any) => row.assetId === asset._id);
      if (!inventoryItem) {
        inventoryItem = {
          _id: `static_inventory_item_${asset._id}_${Date.now()}`,
          societyId: asset.societyId,
          sku: asset.assetTag,
          name: asset.name,
          description: asset.notes,
          category: asset.category,
          itemType: asset.category === "Consumable" ? "consumable" : "asset",
          unitOfMeasure: asset.quantityUnit ?? "each",
          currency: asset.currency ?? "CAD",
          trackSerial: Boolean(asset.serialNumber),
          trackLot: false,
          trackExpiry: false,
          status: asset.status === "Disposed" ? "archived" : "active",
          assetId: asset._id,
          sourceSystem: "societyer_assets",
          createdAtISO: now,
          updatedAtISO: now,
        };
        store?.upsertRow("inventoryItems", inventoryItem);
      }
      const locationName = String(asset.location ?? asset.custodianName ?? "Inventory").trim() || "Inventory";
      const existingLocations = store?.listRows("inventoryLocations", { societyId: asset.societyId }) ?? tables.inventoryLocations;
      let location = existingLocations.find((row: any) => row.name.toLowerCase() === locationName.toLowerCase());
      if (!location) {
        location = {
          _id: `static_inventory_location_${asset._id}_${Date.now()}`,
          societyId: asset.societyId,
          name: locationName,
          locationType: asset.location ? "facility" : "virtual",
          active: true,
          sourceSystem: "societyer_assets",
          createdAtISO: now,
          updatedAtISO: now,
        };
        store?.upsertRow("inventoryLocations", location);
      }
      const expectedQuantity = asset.category === "Consumable"
        ? asset.quantityOnHand ?? 0
        : asset.status === "Disposed" || asset.status === "Lost"
          ? 0
          : 1;
      store?.upsertRow("inventoryCountLines", {
        _id: `static_inventory_count_line_${asset._id}_${Date.now()}`,
        societyId: asset.societyId,
        inventoryCountId,
        inventoryItemId: inventoryItem._id,
        locationId: location._id,
        expectedQuantity,
        status: "pending",
        createdAtISO: now,
        updatedAtISO: now,
      });
      store?.upsertRow("assetVerificationItems", {
        _id: `static_asset_verification_item_${asset._id}_${Date.now()}`,
        societyId: asset.societyId,
        runId,
        assetId: asset._id,
        status: "pending",
        createdAtISO: now,
        updatedAtISO: now,
      });
    });
    return runId;
  }
  if (name === "assets:verifyAsset") {
    const item = store?.getRow("assetVerificationItems", args?.itemId) ?? byId(tables.assetVerificationItems, args?.itemId);
    if (!item) return null;
    const now = new Date().toISOString();
    store?.upsertRow("assetVerificationItems", {
      ...item,
      status: args?.status,
      verifiedAtISO: now,
      verifiedByName: args?.verifiedByName,
      observedLocation: args?.observedLocation,
      observedCondition: args?.observedCondition,
      notes: args?.notes,
      updatedAtISO: now,
    });
    const run = store?.getRow("assetVerificationRuns", item.runId) ?? byId(tables.assetVerificationRuns, item.runId);
    const asset = store?.getRow("assets", item.assetId) ?? byId(tables.assets, item.assetId);
    const inventoryItem = (store?.listRows("inventoryItems", { societyId: item.societyId }) ?? tables.inventoryItems)
      .find((row: any) => row.assetId === item.assetId);
    const count = (store?.listRows("inventoryCounts", { societyId: item.societyId }) ?? tables.inventoryCounts)
      .find((row: any) => row.status === "open" && row.title === run?.title && row.startedAtISO === run?.startedAtISO);
    const countLine = count && inventoryItem
      ? (store?.listRows("inventoryCountLines", { societyId: item.societyId }) ?? tables.inventoryCountLines)
          .find((row: any) => row.inventoryCountId === count._id && row.inventoryItemId === inventoryItem._id)
      : null;
    if (countLine) {
      const countedQuantity = args?.status === "missing" ? 0 : countLine.expectedQuantity ?? (asset?.category === "Consumable" ? asset?.quantityOnHand ?? 0 : 1);
      store?.upsertRow("inventoryCountLines", {
        ...countLine,
        countedQuantity,
        varianceQuantity: countedQuantity - (countLine.expectedQuantity ?? 0),
        condition: args?.observedCondition,
        status: args?.status === "verified" ? "counted" : args?.status,
        notes: args?.notes,
        updatedAtISO: now,
      });
    }
    return args?.itemId;
  }
  if (name === "assets:completeVerificationRun") {
    const run = store?.getRow("assetVerificationRuns", args?.id) ?? byId(tables.assetVerificationRuns, args?.id);
    if (!run) return null;
    const now = new Date().toISOString();
    store?.upsertRow("assetVerificationRuns", { ...run, status: "Completed", completedAtISO: now, updatedAtISO: now });
    const count = (store?.listRows("inventoryCounts", { societyId: run.societyId }) ?? tables.inventoryCounts)
      .find((row: any) => row.status === "open" && row.title === run.title && row.startedAtISO === run.startedAtISO);
    if (count) store?.upsertRow("inventoryCounts", { ...count, status: "completed", completedAtISO: now, updatedAtISO: now });
    return args?.id;
  }
  if (name === "assets:dispose") {
    const asset = store?.getRow("assets", args?.assetId) ?? byId(tables.assets, args?.assetId);
    if (!asset) return null;
    store?.upsertRow("assets", {
      ...asset,
      status: "Disposed",
      disposedAt: args?.disposedAt,
      disposalMethod: args?.disposalMethod,
      disposalReason: args?.disposalReason,
      disposalValueCents: args?.disposalValueCents,
      notes: args?.notes ?? asset.notes,
      updatedAtISO: new Date().toISOString(),
    });
    return args?.assetId;
  }
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
  if (name === "documentVersions:rollback") {
    const target = store?.getRow("documentVersions", args?.versionId);
    if (!target) return null;
    const now = new Date().toISOString();
    const existing = store?.listRows("documentVersions", { documentId: target.documentId }) ?? [];
    store?.transaction(() => {
      for (const row of existing) {
        store.upsertRow("documentVersions", { ...row, isCurrent: row._id === target._id });
      }
      const document = store.getRow("documents", target.documentId);
      if (document) {
        store.upsertRow("documents", {
          ...document,
          fileName: target.fileName,
          mimeType: target.mimeType,
          fileSizeBytes: target.fileSizeBytes,
          updatedAtISO: now,
        });
      }
      store.upsertRow("activity", {
        _id: `static_activity_document_rollback_${Date.now()}`,
        _creationTime: Date.now(),
        societyId: target.societyId,
        actor: "Desktop user",
        entityType: "document",
        entityId: target.documentId,
        action: "version-rollback",
        summary: `Rolled back to ${target.fileName ?? `v${target.version}`}`,
        createdAtISO: now,
      });
    });
    return target._id;
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
  if (name === "documents:flagForDeletion") {
    const existing = store?.getRow("documents", args?.id);
    if (!existing) return null;
    store?.upsertRow("documents", {
      ...existing,
      flaggedForDeletion: args?.flagged === true,
      updatedAtISO: new Date().toISOString(),
    });
    return args?.id;
  }
  if (name === "documents:remove") {
    const existing = store?.getRow("documents", args?.id);
    if (!existing) return null;
    const versions = store?.listRows("documentVersions", { documentId: args?.id }) ?? [];
    for (const version of versions) store?.removeRow("documentVersions", version._id);
    store?.removeRow("documents", args?.id);
    return null;
  }
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

  if (name === "signatures:saveProfile") return staticUpsertSignatureProfile(store, args);
  if (name === "signatures:sign") return staticSign(store, args);
  if (name === "signatures:revoke") {
    store?.removeRow("signatures", args?.id);
    return null;
  }

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

  queryResult(name: string, args: StaticArgs) {
    switch (name) {
      case "agendas:getForMeeting":
        return this.agendaForMeeting(args?.meetingId);
      case "agendas:get": {
        const meetingId = String(args?.agendaId ?? "").replace(/^static_agenda_/, "");
        return this.agendaForMeeting(meetingId);
      }
      case "agendas:listForMeeting": {
        const record = this.agendaForMeeting(args?.meetingId);
        return record ? [record.agenda] : [];
      }
      case "agendas:listForSociety":
        return scopedRows(this.rows("meetings"), args).map((meeting) => this.agendaSummaryForMeeting(meeting));
      case "meetings:get":
        return this.getRow("meetings", args?.id) ?? this.listRows("meetings", args)[0] ?? null;
      case "meetings:list":
        return this.listRows("meetings", args);
      case "minutes:getByMeeting":
        return this.rows("minutes").find((row) => row.meetingId === args?.meetingId) ?? null;
      case "minutes:get":
        return this.getRow("minutes", args?.id);
    }
    return undefined;
  }

  mutationResult(name: string, args: StaticArgs) {
    if (name === "meetings:update") {
      const updated = this.patchRow("meetings", args?.id, args?.patch ?? {});
      return updated?._id ?? null;
    }

    if (name === "agendas:syncForMeeting") {
      const items = Array.isArray(args?.items) ? args.items : [];
      const cleanedItems = items
        .map((item: any) => ({
          title: String(item?.title ?? "").trim(),
          depth: (item?.depth === 1 ? 1 : 0) as 0 | 1,
          type: item?.type,
          presenter: item?.presenter,
          details: item?.details,
          motionText: item?.motionText,
        }))
        .filter((item: any) => item.title);
      const meeting = byId(this.rows("meetings"), args?.meetingId);
      const nowISO = new Date().toISOString();
      // Write the agenda relationally (single source of truth). Reuse the
      // existing agenda row when present; otherwise create one.
      let agendaRow = this.rows("agendas")
        .filter((row) => row.meetingId === args?.meetingId)
        .sort((a, b) => String(a.createdAtISO).localeCompare(String(b.createdAtISO)))[0];
      if (!agendaRow && meeting) {
        agendaRow = {
          _id: `static_agenda_${meeting._id}`,
          societyId: meeting.societyId,
          meetingId: meeting._id,
          title: args?.title || `${meeting.title} agenda`,
          status: args?.status || "Draft",
          createdAtISO: nowISO,
          updatedAtISO: nowISO,
        };
        this.upsertRow("agendas", agendaRow);
      } else if (agendaRow) {
        this.patchRow("agendas", agendaRow._id, {
          title: args?.title || agendaRow.title,
          status: args?.status || agendaRow.status || "Draft",
          updatedAtISO: nowISO,
        });
      }
      if (agendaRow) {
        for (const existing of this.rows("agendaItems").filter((item) => item.agendaId === agendaRow._id)) {
          this.removeRow("agendaItems", existing._id);
        }
        cleanedItems.forEach((item: any, order: number) => {
          this.upsertRow("agendaItems", {
            _id: `static_agenda_item_${agendaRow._id}_${order}`,
            societyId: agendaRow.societyId,
            agendaId: agendaRow._id,
            order,
            type: item.type || staticAgendaItemType(item.title),
            title: item.title,
            depth: item.depth,
            presenter: item.presenter,
            details: item.details,
            motionText: item.motionText,
            createdAtISO: nowISO,
          });
        });
      }
      const minute = this.rows("minutes").find((row) => row.meetingId === args?.meetingId);
      if (minute) {
        this.patchRow("minutes", minute._id, {
          sections: items.filter((item: any) => String(item?.title ?? "").trim()).map((item: any) => ({
            title: String(item.title).trim(),
            type: item.type || staticAgendaItemType(item.title),
            presenter: item.presenter,
            discussion: item.details ?? "",
            decisions: [],
            actionItems: [],
            depth: item.depth === 1 ? 1 : 0,
          })),
          motions: items
            .map((item: any, index: number) => ({
              text: String(item.motionText ?? "").trim(),
              outcome: "Pending",
              resolutionType: "Ordinary",
              sectionIndex: index,
              sectionTitle: item.title,
            }))
            .filter((motion: any) => motion.text),
        });
      }
      return agendaRow?._id ?? null;
    }

    if (name === "agendas:startMinutesFromAgenda") {
      // agendaId is a stored agenda row id; fall back to the legacy
      // `static_agenda_<meetingId>` shape for safety.
      const agendaRow = byId(this.rows("agendas"), args?.agendaId);
      const meetingId = agendaRow?.meetingId ?? String(args?.agendaId ?? "").replace(/^static_agenda_/, "");
      const meeting = byId(this.rows("meetings"), meetingId);
      if (!meeting) return { minutesId: null, reused: false };
      const existing = this.rows("minutes").find((row) => row.meetingId === meetingId);
      if (existing) return { minutesId: existing._id, reused: true };
      const items = agendaRow
        ? this.rows("agendaItems").filter((item) => item.agendaId === agendaRow._id).sort((a, b) => a.order - b.order)
        : [];
      const now = Date.now();
      const row = {
        _id: `static_minutes_${now}`,
        _creationTime: now,
        societyId: meeting.societyId,
        meetingId,
        heldAt: meeting.scheduledAt,
        attendees: meeting.attendeeIds ?? [],
        absent: [],
        quorumMet: false,
        quorumRequired: meeting.quorumRequired,
        discussion: "",
        sections: items.map((item) => ({
          title: item.title,
          type: staticAgendaItemType(item.title),
          discussion: "",
          decisions: [],
          actionItems: [],
          depth: item.depth,
        })),
        motions: [],
        decisions: [],
        actionItems: [],
      };
      this.upsertRow("minutes", row);
      this.patchRow("meetings", meetingId, { minutesId: row._id });
      return { minutesId: row._id, reused: false };
    }

    if (name === "minutes:update") {
      const updated = this.patchRow("minutes", args?.id, args?.patch ?? {});
      return updated?._id ?? null;
    }

    if (name === "minutes:create") {
      const now = Date.now();
      const row = {
        _id: args?.id ?? `static_minutes_${now}`,
        _creationTime: now,
        status: args?.status ?? "Draft",
        createdAtISO: new Date(now).toISOString(),
        updatedAtISO: new Date(now).toISOString(),
        ...args,
      };
      this.upsertRow("minutes", row);
      return row._id;
    }

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

  constructor(options?: { databaseName?: string; seed?: StaticDemoSeed; url?: string }) {
    this.store = new StaticDemoDexieStore(options?.seed ?? STATIC_DEMO_SEED, options);
    this.clientUrl = options?.url ?? "static://societyer-demo";
  }

  get url() {
    return this.clientUrl;
  }

  watchQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    return {
      onUpdate: (callback: () => void) => this.store.onUpdate(callback),
      localQueryResult: () => mutableQueryResult(name, args, this.store),
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
    return Promise.resolve(mutableQueryResult(functionName(query), args, this.store));
  }

  mutation(mutation: any, args?: StaticArgs) {
    return Promise.resolve(mutationResult(functionName(mutation), args, this.store));
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
