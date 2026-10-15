import { getPortable as getAccessibleDocument } from "./documents";
import { bylawBaselineForOrganization, contextualBylawRules } from "../bylawBaselines";
/**
 * PORTABLE FUNCTIONS: the dashboard domain (navCounts / summary).
 *
 * Reads `members / directors / meetings / filings / deadlines / conflicts /
 * committees / goals / tasks / complianceRemediations / activity` (and the
 * society + linked documents/users) over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * The compliance rule pack lives in the pure `shared/dashboardComplianceRules.ts`;
 * only the rules whose audience matches the workspace's entity type and home
 * jurisdiction are evaluated, so a corporation never receives Societies Act
 * checks. The bylaw-rule resolution (`getActiveBylawRuleSet`)
 * is a portable copy of the pure `ctx.db`-only logic from
 * `convex/lib/bylawRules.ts` (that module imports `_generated`, so its logic is
 * inlined on the portable contract rather than reaching into the Convex lib).
 */

import type { PortableDoc, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";
import {
  dashboardComplianceRulePackForOrganization,
  evaluateDashboardComplianceRules,
  type DashboardComplianceFlag,
} from "../dashboardComplianceRules";
import { isHistoricalSourceAction } from "../taskStatus";
import { todayDateOnly } from "../dateOnly";
import { financeControlFindingsFor } from "./expenseReports";
import { isCorporation, isPreparingIncorporation } from "../organizationDomain";


/* ------------------ bylaw-rule resolution (inlined, pure) ---------------- */


export function getDefaultBylawRules(societyId: string, organization?: any) {
  return bylawBaselineForOrganization(organization, societyId);
}

async function getBylawRuleSetForDate(
  ctx: PortableQueryCtx,
  societyId: string,
  dateISO: string,
): Promise<Record<string, any>> {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const targetTs = timestampOrInfinity(dateISO);
  const eligible = rows
    .filter((row) => row.status !== "Draft")
    .filter((row) => effectiveTimestamp(row) <= targetTs);
  const selected = eligible.sort(compareRuleSetsDesc)[0];
  const organization = await ctx.db.get(societyId);
  return contextualBylawRules(organization, societyId, selected);
}

async function getActiveBylawRuleSet(ctx: PortableQueryCtx, societyId: string) {
  return getBylawRuleSetForDate(ctx, societyId, new Date().toISOString());
}

// Versions are effective from a calendar day. "Reset to defaults" stamps the
// click instant while "Save new version" stamps midnight of the chosen day, so
// two versions effective the same day are ordered by version, not by time.
function compareRuleSetsDesc(a: any, b: any) {
  const byDay = effectiveDay(b).localeCompare(effectiveDay(a));
  if (byDay !== 0) return byDay;
  return (Number(b.version) || 0) - (Number(a.version) || 0);
}

function effectiveDay(row: any) {
  return typeof row.effectiveFromISO === "string" ? row.effectiveFromISO.slice(0, 10) : "";
}

function effectiveTimestamp(row: any) {
  return timestampOrNegativeInfinity(row.effectiveFromISO);
}

function timestampOrInfinity(value: string) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function timestampOrNegativeInfinity(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

/* ----------------------------- domain types ------------------------------ */

type DashboardId = string;

type DashboardSociety = {
  _id: DashboardId;
  name: string;
  incorporationNumber?: string;
  fiscalYearEnd?: string;
  isCharity: boolean;
  isMemberFunded: boolean;
  registeredOfficeAddress?: string;
  boardCadence?: string;
};

type DashboardFiling = {
  _id: DashboardId;
  kind: string;
  periodLabel?: string;
  dueDate: string;
  filedAt?: string;
  submittedByUserId?: DashboardId;
  confirmationNumber?: string;
  receiptDocumentId?: DashboardId;
  stagedPacketDocumentId?: DashboardId;
  sourceDocumentIds?: DashboardId[];
  evidenceNotes?: string;
  status: string;
};

type DashboardMeeting = {
  _id: DashboardId;
  type: string;
  title: string;
  scheduledAt: string;
  location?: string;
  status: string;
};

type DashboardBoardMember = {
  _id: DashboardId;
  name: string;
  position: string;
  termStart: string;
  termEnd?: string;
  isBCResident: boolean;
};

type DashboardTask = {
  _id: DashboardId;
  title: string;
  status: string;
  priority: string;
  assignee?: string;
  dueDate?: string;
};

type DashboardGoal = {
  _id: DashboardId;
  title: string;
  status: string;
  progressPercent: number;
  targetDate: string;
};

type DashboardSummary = {
  readAccess: Permission[];
  society: DashboardSociety | null;
  counts: {
    members: number;
    directors: number;
    bcResidents: number;
    meetingsThisYear: number;
    overdueFilings: number;
    openDeadlines: number;
    openConflicts: number;
    committees: number;
    openGoals: number;
    openTasks: number;
  };
  board: DashboardBoardMember[];
  upcomingMeetings: DashboardMeeting[];
  upcomingFilings: DashboardFiling[];
  overdueFilings: DashboardFiling[];
  goals: DashboardGoal[];
  openTasks: DashboardTask[];
  complianceFlags: DashboardComplianceFlag[];
  evidenceChains: EvidenceChain[];
};

type SocietyRecord = DashboardSociety & {
  entityType?: string;
  actFormedUnder?: string;
  jurisdictionCode?: string;
  homeJurisdictionCode?: string;
  privacyPolicyDocId?: string;
  privacyProgramStatus?: string;
  memberDataAccessStatus?: string;
  memberDataGapDocumented?: boolean;
  constitutionDocId?: string;
  bylawsDocId?: string;
  formationStatus?: string;
  organizationStatus?: string;
};

type GoalRecord = DashboardGoal & {
  status: string;
};

type TaskRecord = DashboardTask;

type EvidenceChain = {
  id: string;
  title: string;
  status: "verified" | "incomplete";
  summary: string;
  actionHref?: string;
  nodes: Array<{
    label: string;
    value: string;
    status: "verified" | "missing" | "info";
    href?: string;
  }>;
};

const OPEN_GOAL_STATUSES = ["AtRisk", "OffTrack", "OnTrack", "NotStarted"];
const OPEN_TASK_STATUSES = ["Todo", "InProgress", "Blocked"];
const PREVIEW_SCAN_LIMIT = 100;

// society:read is required to open the dashboard at all; listing it also
// reports it in readAccess, so the setup guide's profile step is shown.
const DASHBOARD_READ_PERMISSIONS: readonly Permission[] = ["society:read", "members:read", "directors:read", "meetings:read", "filings:read", "deadlines:read", "conflicts:read", "committees:read", "commitments:read", "tasks:read", "documents:read", "users:read", "audit:read", "settings:read", "financials:read"];

async function dashboardReadAccess(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "society:read");
  const readable = await Promise.all(DASHBOARD_READ_PERMISSIONS.map(async permission => {
    try { await requirePermissionPortable(ctx, societyId, permission); return permission; }
    catch (error) {
      if (error instanceof Error && /^(?:Permission|Service scope) [a-zA-Z]+:read required\.$/.test(error.message)) return null;
      throw error;
    }
  }));
  return new Set(readable.filter((permission): permission is Permission => permission !== null));
}

/* ------------------------------- handlers -------------------------------- */

export async function navCountsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const readAccess = await dashboardReadAccess(ctx, societyId);
  const nowDate = new Date();
  const nowISO = nowDate.toISOString();
  // Date-only due dates compare against the local calendar day: a filing due today is not overdue.
  const todayKey = todayDateOnly(nowDate);
  const year = nowDate.getFullYear();
  const yearStartISO = `${year}-01-01T00:00:00.000Z`;
  const nextYearStartISO = `${year + 1}-01-01T00:00:00.000Z`;

  const [
    activeMembers,
    activeDirectors,
    meetingsThisYear,
    overdueFilingRows,
    openDeadlines,
    openConflicts,
    activeCommittees,
    goals,
    tasks,
  ] = await Promise.all([
    readAccess.has("members:read") ? ctx.db.query("members").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect() : Promise.resolve([]),
    readAccess.has("directors:read") ? ctx.db.query("directors").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect() : Promise.resolve([]),
    readAccess.has("meetings:read") ? ctx.db.query("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", yearStartISO).lt("scheduledAt", nextYearStartISO)).collect() : Promise.resolve([]),
    readAccess.has("filings:read") ? ctx.db.query("filings").withIndex("by_society_due", (q) => q.eq("societyId", societyId).lt("dueDate", todayKey)).collect() : Promise.resolve([]),
    readAccess.has("deadlines:read") ? ctx.db.query("deadlines").withIndex("by_society_done", (q) => q.eq("societyId", societyId).eq("done", false)).collect() : Promise.resolve([]),
    readAccess.has("conflicts:read") ? ctx.db.query("conflicts").withIndex("by_society_resolved", (q) => q.eq("societyId", societyId).eq("resolvedAt", undefined)).collect() : Promise.resolve([]),
    readAccess.has("committees:read") ? ctx.db.query("committees").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect() : Promise.resolve([]),
    readAccess.has("commitments:read") ? collectStatuses(ctx, "goals", societyId, OPEN_GOAL_STATUSES) : Promise.resolve([]),
    readAccess.has("tasks:read") ? collectStatuses(ctx, "tasks", societyId, OPEN_TASK_STATUSES) : Promise.resolve([]),
  ]);

  return {
    members: activeMembers.length,
    directors: activeDirectors.length,
    meetingsThisYear: meetingsThisYear.length,
    overdueFilings: overdueFilingRows.filter((filing) => filing.status !== "Filed").length,
    openDeadlines: openDeadlines.length,
    openConflicts: openConflicts.length,
    committees: activeCommittees.length,
    openGoals: goals.length,
    openTasks: tasks.filter((task) => !isHistoricalSourceAction(task as any)).length,
  };
}

export async function summaryPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
): Promise<DashboardSummary> {
  const readAccess = await dashboardReadAccess(ctx, societyId);
  const nowDate = new Date();
  const nowISO = nowDate.toISOString();
  // Date-only due dates compare against the local calendar day: a filing due today is not overdue.
  const todayKey = todayDateOnly(nowDate);
  const year = nowDate.getFullYear();
  const yearStartISO = `${year}-01-01T00:00:00.000Z`;
  const nextYearStartISO = `${year + 1}-01-01T00:00:00.000Z`;

  const [
    society,
    activeMembers,
    activeDirectors,
    meetingsThisYear,
    upcomingMeetingCandidates,
    overdueFilingRows,
    upcomingFilingCandidates,
    filingRows,
    openDeadlines,
    openConflicts,
    activeCommittees,
    goals,
    tasks,
    complianceRemediations,
    rules,
  ] = await Promise.all([
    ctx.db.get<SocietyRecord>(societyId, "societies"),
    readAccess.has("members:read") ? ctx.db.query("members").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect() : Promise.resolve([]),
    readAccess.has("directors:read") ? ctx.db.query<any>("directors").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect() : Promise.resolve([]),
    readAccess.has("meetings:read") ? ctx.db.query<DashboardMeeting & PortableDoc>("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", yearStartISO).lt("scheduledAt", nextYearStartISO)).collect() : Promise.resolve([]),
    readAccess.has("meetings:read") ? ctx.db.query<DashboardMeeting & PortableDoc>("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", upcomingMeetingsFromISO(nowISO, todayKey))).take(PREVIEW_SCAN_LIMIT) : Promise.resolve([]),
    readAccess.has("filings:read") ? ctx.db.query<DashboardFiling & PortableDoc>("filings").withIndex("by_society_due", (q) => q.eq("societyId", societyId).lt("dueDate", todayKey)).collect() : Promise.resolve([]),
    readAccess.has("filings:read") ? ctx.db.query<DashboardFiling & PortableDoc>("filings").withIndex("by_society_due", (q) => q.eq("societyId", societyId).gte("dueDate", todayKey)).take(PREVIEW_SCAN_LIMIT) : Promise.resolve([]),
    readAccess.has("filings:read") ? ctx.db.query<DashboardFiling & PortableDoc>("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect() : Promise.resolve([]),
    readAccess.has("deadlines:read") ? ctx.db.query("deadlines").withIndex("by_society_done", (q) => q.eq("societyId", societyId).eq("done", false)).collect() : Promise.resolve([]),
    readAccess.has("conflicts:read") ? ctx.db.query("conflicts").withIndex("by_society_resolved", (q) => q.eq("societyId", societyId).eq("resolvedAt", undefined)).collect() : Promise.resolve([]),
    readAccess.has("committees:read") ? ctx.db.query("committees").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect() : Promise.resolve([]),
    readAccess.has("commitments:read") ? collectStatuses(ctx, "goals", societyId, OPEN_GOAL_STATUSES) : Promise.resolve([]),
    readAccess.has("tasks:read") ? collectStatuses(ctx, "tasks", societyId, OPEN_TASK_STATUSES) : Promise.resolve([]),
    readAccess.has("deadlines:read") ? ctx.db.query("complianceRemediations").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect() : Promise.resolve([]),
    readAccess.has("documents:read") ? getActiveBylawRuleSet(ctx, societyId) : Promise.resolve(null),
  ]);
  const corporation = isCorporation(society);
  const preparing = isPreparingIncorporation(society);
  // A corporation's directors are usually kept on Corporation people (the
  // role-holder register) rather than the society director roster, so both
  // count; a person on both is counted once.
  const roleHolderDirectors = corporation && readAccess.has("directors:read")
    ? (await ctx.db.query<any>("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect())
        .filter((row) => row.roleType === "director" && row.status === "current")
    : [];
  const rosterNames = new Set(activeDirectors.map((director) => personNameKey(`${director.firstName ?? ""} ${director.lastName ?? ""}`)));
  const extraDirectors = roleHolderDirectors.filter((row) => !rosterNames.has(personNameKey(roleHolderName(row))));
  const legalDirectors = [...activeDirectors, ...extraDirectors.map(roleHolderAsDirector)];

  const bcResidents = activeDirectors.filter((d) => d.isBCResident).length;
  // Board roster for the overview card — officers (chair/president/etc.) first,
  // then the rest alphabetically, capped so the card stays glanceable.
  const officerRank = (position: string): number =>
    /chair|president/i.test(position) ? 0
    : /vice|treasurer|secretary/i.test(position) ? 1
    : 2;
  const board: DashboardBoardMember[] = [...legalDirectors]
    .sort((a, b) =>
      officerRank(a.position) - officerRank(b.position) ||
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
    )
    .slice(0, 6)
    .map((d) => ({
      _id: d._id,
      name: `${d.firstName} ${d.lastName}`.trim(),
      position: d.position,
      termStart: d.termStart,
      termEnd: d.termEnd,
      isBCResident: d.isBCResident,
    }));
  const upcomingMeetings = upcomingMeetingCandidates
    .filter((m) => m.status === "Scheduled")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const overdueFilings = overdueFilingRows.filter((f) => f.status !== "Filed");
  const upcomingFilings = upcomingFilingCandidates
    .filter((f) => f.status !== "Filed")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const goalPreview = goals
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
    .slice(0, 4);
  const openTaskPreview = tasks.filter((task) => !isHistoricalSourceAction(task as any))
    .sort((a, b) => compareOptionalDates(a.dueDate, b.dueDate))
    .slice(0, 6);
  const canReadEvidence = ["filings:read", "documents:read", "users:read", "audit:read"].every(permission => readAccess.has(permission as Permission));
  const evidenceChains = canReadEvidence ? await buildEvidenceChains(ctx, societyId, filingRows) : [];
  const remediationByRuleId = new Map(
    complianceRemediations
      .sort((a, b) => String(b.updatedAtISO ?? "").localeCompare(String(a.updatedAtISO ?? "")))
      .map((row: Record<string, any>) => [row.ruleId, row]),
  );
  // Only rules written for this entity type and home jurisdiction apply.
  const applicableRulePack = dashboardComplianceRulePackForOrganization(society);
  const visibleRules = applicableRulePack.rules.filter(rule => {
    if (rule.id.startsWith("BC-SOC-DIRECTOR") || /-DIRECTOR/.test(rule.id)) return readAccess.has("directors:read");
    if (rule.id.startsWith("MEMBER-DATA")) return readAccess.has("members:read") && readAccess.has("documents:read");
    return readAccess.has("documents:read");
  });
  const legalFlags = evaluateDashboardComplianceRules({
    society: society
      ? {
          ...society,
          isMemberFunded: society.isMemberFunded,
          privacyPolicyDocId: society.privacyPolicyDocId,
          privacyProgramStatus: society.privacyProgramStatus,
          memberDataAccessStatus: society.memberDataAccessStatus,
          memberDataGapDocumented: society.memberDataGapDocumented,
          constitutionDocId: society.constitutionDocId,
          bylawsDocId: society.bylawsDocId,
        }
      : null,
    activeDirectors: legalDirectors.map((director: Record<string, any>) => ({
      consentOnFile: director.consentOnFile,
      isBCResident: director.isBCResident,
      residentCanadianStatus: director.residentCanadianStatus,
    })),
    rulesConfigured: Boolean(rules?._id),
  }, { ...applicableRulePack, rules: visibleRules }, visibleRules.length === applicableRulePack.rules.length);
  // Before the certificate there is no legal entity yet: director minimums,
  // residency and the other statutory checks do not apply, so a preparing
  // organization gets one neutral note instead of red flags on day one.
  const evidenceFlags: DashboardComplianceFlag[] = preparing && society ? [preparingComplianceNote(society)] : legalFlags;
  // Finance controls (expense approval rules) for people who can read the
  // books. They are internal-control findings, not statutory checks, so they
  // carry no citation; any finding replaces the "no gaps" line.
  const financeFlags: DashboardComplianceFlag[] = readAccess.has("financials:read")
    ? (await financeControlFindingsFor(ctx, societyId)).map((finding) => ({
        ruleId: finding.id,
        level: finding.level,
        text: finding.text,
        evidenceRequired: ["Expense approval rules", "Signing-authority register"],
        remediationActions: [{ id: "fix-approval-rules", label: finding.fixLabel, intent: "navigate", to: finding.fixTo }],
      }))
    : [];
  const complianceFlags = (financeFlags.length ? [...evidenceFlags.filter((flag) => flag.ruleId !== "DASHBOARD-COMPLIANCE-OK"), ...financeFlags] : evidenceFlags).map((flag) => {
    const remediation = remediationByRuleId.get(flag.ruleId);
    return remediation
      ? {
          ...flag,
          remediationStatus: remediation.status,
          remediationTaskId: remediation.taskId,
          remediationUpdatedAtISO: remediation.updatedAtISO,
        }
      : flag;
  });

  return {
    readAccess: [...readAccess],
    society: toDashboardSociety(society),
    counts: {
      members: activeMembers.length,
      directors: legalDirectors.length,
      bcResidents,
      meetingsThisYear: meetingsThisYear.length,
      overdueFilings: overdueFilings.length,
      openDeadlines: openDeadlines.length,
      openConflicts: openConflicts.length,
      committees: activeCommittees.length,
      openGoals: goals.length,
      openTasks: tasks.filter((task) => !isHistoricalSourceAction(task as any)).length,
    },
    board,
    upcomingMeetings: upcomingMeetings.slice(0, 3).map(toDashboardMeeting),
    upcomingFilings: upcomingFilings.slice(0, 5).map(toDashboardFiling),
    overdueFilings: overdueFilings.slice(0, 12).map(toDashboardFiling),
    goals: goalPreview.map(toDashboardGoal),
    openTasks: openTaskPreview.map(toDashboardTask),
    complianceFlags,
    evidenceChains,
  };
}

function personNameKey(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function roleHolderName(row: Record<string, any>) {
  return String(row.fullName || [row.firstName, row.lastName].filter(Boolean).join(" ") || "");
}

/** Residency on the role-holder record, read the way the director rules expect it. */
function roleHolderResidentCanadian(value?: string): "yes" | "no" | "unknown" {
  if (!value) return "unknown";
  if (value.startsWith("a_canadian_citizen_ordinarily_resident") || value.startsWith("a_permanent_resident") || value === "a_canadian_citizen_that_meets_the_test_in_schedule_a") return "yes";
  if (value.startsWith("not_a_canadian_citizen") || value.startsWith("a_canadian_citizen_that_is_not_ordinarily_resident")) return "no";
  return "unknown";
}

function roleHolderAsDirector(row: Record<string, any>) {
  const name = roleHolderName(row);
  return {
    _id: row._id,
    firstName: name,
    lastName: "",
    position: row.officerTitle ? "Director and officer" : "Director",
    termStart: row.startDate,
    termEnd: row.endDate,
    isBCResident: false,
    // Consent to act is kept as evidence on the director roster; a register
    // entry alone does not show it.
    consentOnFile: false,
    residentCanadianStatus: roleHolderResidentCanadian(row.citizenshipResidency),
  };
}

function preparingComplianceNote(society: SocietyRecord): DashboardComplianceFlag {
  return {
    ruleId: "DASHBOARD-COMPLIANCE-PREPARING",
    level: "ok",
    text: `${society.name || "This organization"} isn't incorporated yet. Legal checks start once the certificate of incorporation is recorded.`,
    evidenceRequired: [],
    remediationActions: [
      { id: "continue-setup", label: "Continue setup", intent: "navigate", to: "/app/organization-setup" },
    ],
  };
}

async function collectStatuses(
  ctx: PortableQueryCtx,
  tableName: "goals" | "tasks",
  societyId: string,
  statuses: string[],
): Promise<any[]> {
  const rows = await Promise.all(
    statuses.map((status) =>
      ctx.db.query(tableName)
        .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status))
        .collect(),
    ),
  );
  return rows.flat();
}

function compareOptionalDates(a?: string, b?: string) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function toDashboardSociety(society: SocietyRecord | null): DashboardSociety | null {
  if (!society) return null;
  return {
    _id: society._id,
    name: society.name,
    incorporationNumber: society.incorporationNumber,
    fiscalYearEnd: society.fiscalYearEnd,
    isCharity: society.isCharity,
    isMemberFunded: society.isMemberFunded,
    registeredOfficeAddress: society.registeredOfficeAddress,
    boardCadence: society.boardCadence,
  };
}

function toDashboardFiling(filing: DashboardFiling): DashboardFiling {
  return {
    _id: filing._id,
    kind: filing.kind,
    periodLabel: filing.periodLabel,
    dueDate: filing.dueDate,
    status: filing.status,
  };
}

async function buildEvidenceChains(
  ctx: PortableQueryCtx,
  societyId: string,
  filings: DashboardFiling[],
): Promise<EvidenceChain[]> {
  const filed = filings
    .filter((filing) => filing.status === "Filed")
    .sort((a, b) => (b.filedAt ?? b.dueDate).localeCompare(a.filedAt ?? a.dueDate))
    .slice(0, 3);

  return Promise.all(filed.map((filing) => buildFilingEvidenceChain(ctx, societyId, filing)));
}

async function buildFilingEvidenceChain(
  ctx: PortableQueryCtx,
  societyId: string,
  filing: DashboardFiling,
): Promise<EvidenceChain> {
  const documentIds = [
    filing.receiptDocumentId,
    filing.stagedPacketDocumentId,
    ...(filing.sourceDocumentIds ?? []),
  ].filter(Boolean) as DashboardId[];
  const [documents, submitter, indexedAuditEvents] = await Promise.all([
    Promise.all(documentIds.map((id) => getAccessibleDocument(ctx, { id: String(id) }))),
    filing.submittedByUserId
      ? getOwned(ctx, "users", filing.submittedByUserId, societyId)
      : Promise.resolve(null),
    ctx.db
      .query("activity")
      // TODO(H0-flip): query by_subject after the hosted backfill is complete.
      .withIndex("by_entity", (q) => q.eq("societyId", societyId).eq("entityType", "filing").eq("entityId", filing._id))
      .collect(),
  ]);
  const auditEvents = indexedAuditEvents.filter((event) => (event.subjectId ?? event.entityId) === filing._id);
  const evidenceDocument = documents.find(Boolean);
  const auditEvent = auditEvents
    .sort((a: any, b: any) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)))
    .find((event: any) => event.action === "filed" || event.action === "prepared" || event.action);
  const nodes = [
    { label: "Compliance result", value: `${filingKindLabel(filing.kind)} complete`, status: "verified" as const },
    { label: "Filing record", value: filing.periodLabel ? `${filing.periodLabel} filing` : filingKindLabel(filing.kind), status: "verified" as const, href: "/app/filings" },
    { label: "Filing date", value: filing.filedAt ?? "Missing filed date", status: filing.filedAt ? "verified" as const : "missing" as const },
    {
      label: "Confirmation / evidence",
      value: filing.confirmationNumber
        ? `Confirmation ${filing.confirmationNumber}`
        : evidenceDocument?.title ?? filing.evidenceNotes ?? "Missing confirmation evidence",
      status: filing.confirmationNumber || evidenceDocument || filing.evidenceNotes ? "verified" as const : "missing" as const,
      href: evidenceDocument?._id ? "/app/documents" : undefined,
    },
    {
      label: "Responsible person",
      value: submitter?.displayName ?? submitter?.name ?? "Unassigned",
      status: submitter ? "verified" as const : "missing" as const,
    },
    {
      label: "Audit log",
      value: auditEvent ? `${auditEvent.actor} ${auditEvent.action} ${formatEvidenceDate(auditEvent.createdAtISO)}` : "No matching audit event",
      status: auditEvent ? "verified" as const : "missing" as const,
      href: "/app/audit",
    },
  ];

  return {
    id: filing._id,
    title: `${filingKindLabel(filing.kind)} proof chain`,
    status: nodes.some((node) => node.status === "missing") ? "incomplete" : "verified",
    summary: nodes.some((node) => node.status === "missing")
      ? "Filed, but one or more proof links need attention."
      : "Every link needed to explain why this is complete is present.",
    actionHref: "/app/filings",
    nodes,
  };
}

function filingKindLabel(kind: string) {
  switch (kind) {
    case "AnnualReport":
      return "Annual report";
    case "ChangeOfDirectors":
      return "Change of directors";
    case "ChangeOfAddress":
      return "Change of address";
    case "BylawAmendment":
      return "Bylaw amendment";
    case "T3010":
      return "CRA T3010";
    default:
      return kind;
  }
}

function formatEvidenceDate(value?: string) {
  return value ? value.slice(0, 10) : "";
}

function toDashboardMeeting(meeting: DashboardMeeting): DashboardMeeting {
  return {
    _id: meeting._id,
    type: meeting.type,
    title: meeting.title,
    scheduledAt: meeting.scheduledAt,
    location: meeting.location,
    status: meeting.status,
  };
}

function toDashboardTask(task: TaskRecord): DashboardTask {
  return {
    _id: task._id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    dueDate: task.dueDate,
  };
}

function toDashboardGoal(goal: GoalRecord): DashboardGoal {
  return {
    _id: goal._id,
    title: goal.title,
    status: goal.status,
    progressPercent: goal.progressPercent,
    targetDate: goal.targetDate,
  };
}

/**
 * Lower bound for "upcoming" meetings. Date-only meetings are stored at a
 * noon-UTC placeholder, which is already in the past on a BC evening, so a
 * meeting later today dropped off the dashboard. Start from the beginning of
 * the viewer's local day (as a UTC day key) or now, whichever is earlier.
 */
export function upcomingMeetingsFromISO(nowISO: string, todayKey: string): string {
  const startOfToday = `${todayKey}T00:00:00.000Z`;
  return startOfToday < nowISO ? startOfToday : nowISO;
}
