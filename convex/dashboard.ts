import { query } from "./_generated/server";
import { v } from "convex/values";
import { getActiveBylawRuleSet } from "./lib/bylawRules";
import {
  DashboardComplianceFlag,
  evaluateDashboardComplianceRules,
} from "./lib/dashboardComplianceRules";

const validator = v as unknown as {
  id: (tableName: string) => unknown;
  string: () => unknown;
  number: () => unknown;
  boolean: () => unknown;
  null: () => unknown;
  literal: (value: string) => unknown;
  optional: (value: unknown) => unknown;
  array: (value: unknown) => unknown;
  object: (fields: Record<string, unknown>) => unknown;
  union: (...values: unknown[]) => unknown;
};

const complianceFlagValidator = validator.object({
  ruleId: validator.string(),
  level: validator.union(validator.literal("ok"), validator.literal("warn"), validator.literal("err")),
  text: validator.string(),
  citationId: validator.optional(validator.string()),
  citationIds: validator.optional(validator.array(validator.string())),
  evidenceRequired: validator.array(validator.string()),
  remediationActions: validator.array(validator.object({
    id: validator.string(),
    label: validator.string(),
    intent: validator.string(),
    to: validator.optional(validator.string()),
  })),
  remediationStatus: validator.optional(validator.string()),
  remediationTaskId: validator.optional(validator.id("tasks")),
  remediationUpdatedAtISO: validator.optional(validator.string()),
});

const dashboardSocietyValidator = validator.union(
  validator.null(),
  validator.object({
    _id: validator.id("societies"),
    name: validator.string(),
    incorporationNumber: validator.optional(validator.string()),
    fiscalYearEnd: validator.optional(validator.string()),
    isCharity: validator.boolean(),
    isMemberFunded: validator.boolean(),
    registeredOfficeAddress: validator.optional(validator.string()),
    boardCadence: validator.optional(validator.string()),
  }),
);

const dashboardFilingValidator = validator.object({
  _id: validator.id("filings"),
  kind: validator.string(),
  periodLabel: validator.optional(validator.string()),
  dueDate: validator.string(),
  status: validator.string(),
});

const evidenceChainValidator = validator.object({
  id: validator.string(),
  title: validator.string(),
  status: validator.union(validator.literal("verified"), validator.literal("incomplete")),
  summary: validator.string(),
  actionHref: validator.optional(validator.string()),
  nodes: validator.array(validator.object({
    label: validator.string(),
    value: validator.string(),
    status: validator.union(validator.literal("verified"), validator.literal("missing"), validator.literal("info")),
    href: validator.optional(validator.string()),
  })),
});

const dashboardMeetingValidator = validator.object({
  _id: validator.id("meetings"),
  type: validator.string(),
  title: validator.string(),
  scheduledAt: validator.string(),
  location: validator.optional(validator.string()),
  status: validator.string(),
});

const dashboardTaskValidator = validator.object({
  _id: validator.id("tasks"),
  title: validator.string(),
  status: validator.string(),
  priority: validator.string(),
  assignee: validator.optional(validator.string()),
  dueDate: validator.optional(validator.string()),
});

const dashboardGoalValidator = validator.object({
  _id: validator.id("goals"),
  title: validator.string(),
  status: validator.string(),
  progressPercent: validator.number(),
  targetDate: validator.string(),
});

const dashboardSummaryValidator = validator.object({
  society: dashboardSocietyValidator,
  counts: validator.object({
    members: validator.number(),
    directors: validator.number(),
    bcResidents: validator.number(),
    meetingsThisYear: validator.number(),
    overdueFilings: validator.number(),
    openDeadlines: validator.number(),
    openConflicts: validator.number(),
    committees: validator.number(),
    openGoals: validator.number(),
    openTasks: validator.number(),
  }),
  upcomingMeetings: validator.array(dashboardMeetingValidator),
  upcomingFilings: validator.array(dashboardFilingValidator),
  overdueFilings: validator.array(dashboardFilingValidator),
  goals: validator.array(dashboardGoalValidator),
  openTasks: validator.array(dashboardTaskValidator),
  complianceFlags: validator.array(complianceFlagValidator),
  evidenceChains: validator.array(evidenceChainValidator),
});

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
  upcomingMeetings: DashboardMeeting[];
  upcomingFilings: DashboardFiling[];
  overdueFilings: DashboardFiling[];
  goals: DashboardGoal[];
  openTasks: DashboardTask[];
  complianceFlags: DashboardComplianceFlag[];
  evidenceChains: EvidenceChain[];
};

type SocietyRecord = DashboardSociety & {
  privacyPolicyDocId?: string;
  privacyProgramStatus?: string;
  memberDataAccessStatus?: string;
  memberDataGapDocumented?: boolean;
  constitutionDocId?: string;
  bylawsDocId?: string;
};

type MemberRecord = {
  status: string;
};

type DirectorRecord = {
  status: string;
  isBCResident: boolean;
  consentOnFile: boolean;
};

type DeadlineRecord = {
  done: boolean;
};

type ConflictRecord = {
  resolvedAt?: string;
};

type CommitteeRecord = {
  status: string;
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

type BylawRuleSetRecord = {
  _id?: DashboardId;
};

type ComplianceRemediationRecord = {
  ruleId: string;
  status: string;
  taskId?: DashboardId;
  updatedAtISO?: string;
};

type IndexedQuery<T> = {
  withIndex: (indexName: string, cb: (q: any) => unknown) => {
    order: (direction: "asc" | "desc") => { collect: () => Promise<T[]> };
    collect: () => Promise<T[]>;
    take: (limit: number) => Promise<T[]>;
  };
};

const OPEN_GOAL_STATUSES = ["AtRisk", "OffTrack", "OnTrack", "NotStarted"];
const OPEN_TASK_STATUSES = ["Todo", "InProgress", "Blocked"];
const PREVIEW_SCAN_LIMIT = 100;

type DashboardQueryCtx = {
  db: {
    get: (id: DashboardId) => Promise<any | null>;
    query: {
      (tableName: "members"): IndexedQuery<MemberRecord>;
      (tableName: "directors"): IndexedQuery<DirectorRecord>;
      (tableName: "meetings"): IndexedQuery<DashboardMeeting>;
      (tableName: "filings"): IndexedQuery<DashboardFiling>;
      (tableName: "deadlines"): IndexedQuery<DeadlineRecord>;
      (tableName: "conflicts"): IndexedQuery<ConflictRecord>;
      (tableName: "committees"): IndexedQuery<CommitteeRecord>;
      (tableName: "goals"): IndexedQuery<GoalRecord>;
      (tableName: "tasks"): IndexedQuery<TaskRecord>;
      (tableName: "activity"): IndexedQuery<any>;
      (tableName: "complianceRemediations"): IndexedQuery<ComplianceRemediationRecord>;
    };
  };
};

const summaryDefinition = {
  args: { societyId: validator.id("societies") },
  returns: dashboardSummaryValidator,
  handler: async (ctx, { societyId }): Promise<DashboardSummary> => {
    const nowDate = new Date();
    const nowISO = nowDate.toISOString();
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
      ctx.db.get(societyId),
      ctx.db.query("members").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
      ctx.db.query("directors").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
      ctx.db.query("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", yearStartISO).lt("scheduledAt", nextYearStartISO)).collect(),
      ctx.db.query("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", nowISO)).take(PREVIEW_SCAN_LIMIT),
      ctx.db.query("filings").withIndex("by_society_due", (q) => q.eq("societyId", societyId).lt("dueDate", nowISO)).collect(),
      ctx.db.query("filings").withIndex("by_society_due", (q) => q.eq("societyId", societyId).gte("dueDate", nowISO)).take(PREVIEW_SCAN_LIMIT),
      ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("deadlines").withIndex("by_society_done", (q) => q.eq("societyId", societyId).eq("done", false)).collect(),
      ctx.db.query("conflicts").withIndex("by_society_resolved", (q) => q.eq("societyId", societyId).eq("resolvedAt", undefined)).collect(),
      ctx.db.query("committees").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
      collectStatuses(ctx, "goals", societyId, OPEN_GOAL_STATUSES),
      collectStatuses(ctx, "tasks", societyId, OPEN_TASK_STATUSES),
      ctx.db.query("complianceRemediations").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      getActiveBylawRuleSet(ctx as never, societyId as never) as Promise<BylawRuleSetRecord>,
    ]);

    const bcResidents = activeDirectors.filter((d) => d.isBCResident).length;
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
    const openTaskPreview = tasks
      .sort((a, b) => compareOptionalDates(a.dueDate, b.dueDate))
      .slice(0, 6);
    const evidenceChains = await buildEvidenceChains(ctx, societyId, filingRows);
    const remediationByRuleId = new Map(
      complianceRemediations
        .sort((a, b) => String(b.updatedAtISO ?? "").localeCompare(String(a.updatedAtISO ?? "")))
        .map((row) => [row.ruleId, row]),
    );
    const complianceFlags = evaluateDashboardComplianceRules({
      society: society
        ? {
            isMemberFunded: society.isMemberFunded,
            privacyPolicyDocId: society.privacyPolicyDocId,
            privacyProgramStatus: society.privacyProgramStatus,
            memberDataAccessStatus: society.memberDataAccessStatus,
            memberDataGapDocumented: society.memberDataGapDocumented,
            constitutionDocId: society.constitutionDocId,
            bylawsDocId: society.bylawsDocId,
          }
        : null,
      activeDirectors: activeDirectors.map((director) => ({
        consentOnFile: director.consentOnFile,
        isBCResident: director.isBCResident,
      })),
      rulesConfigured: Boolean(rules._id),
    }).map((flag) => {
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
      society: toDashboardSociety(society),
      counts: {
        members: activeMembers.length,
        directors: activeDirectors.length,
        bcResidents,
        meetingsThisYear: meetingsThisYear.length,
        overdueFilings: overdueFilings.length,
        openDeadlines: openDeadlines.length,
        openConflicts: openConflicts.length,
        committees: activeCommittees.length,
        openGoals: goals.length,
        openTasks: tasks.length,
      },
      upcomingMeetings: upcomingMeetings.slice(0, 3).map(toDashboardMeeting),
      upcomingFilings: upcomingFilings.slice(0, 5).map(toDashboardFiling),
      overdueFilings: overdueFilings.slice(0, 12).map(toDashboardFiling),
      goals: goalPreview.map(toDashboardGoal),
      openTasks: openTaskPreview.map(toDashboardTask),
      complianceFlags,
      evidenceChains,
    };
  },
} satisfies {
  args: Record<string, unknown>;
  returns: unknown;
  handler: (ctx: DashboardQueryCtx, args: { societyId: DashboardId }) => Promise<DashboardSummary>;
};

export const summary = (query as any)(summaryDefinition);

async function collectStatuses<TableName extends "goals" | "tasks">(
  ctx: DashboardQueryCtx,
  tableName: TableName,
  societyId: DashboardId,
  statuses: string[],
): Promise<(TableName extends "goals" ? GoalRecord : TaskRecord)[]> {
  const rows = await Promise.all(
    statuses.map((status) =>
      (ctx.db.query as any)(tableName)
        .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status))
        .collect(),
    ),
  );
  return rows.flat() as (TableName extends "goals" ? GoalRecord : TaskRecord)[];
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
  ctx: DashboardQueryCtx,
  societyId: DashboardId,
  filings: DashboardFiling[],
): Promise<EvidenceChain[]> {
  const filed = filings
    .filter((filing) => filing.status === "Filed")
    .sort((a, b) => (b.filedAt ?? b.dueDate).localeCompare(a.filedAt ?? a.dueDate))
    .slice(0, 3);

  return Promise.all(filed.map((filing) => buildFilingEvidenceChain(ctx, societyId, filing)));
}

async function buildFilingEvidenceChain(
  ctx: DashboardQueryCtx,
  societyId: DashboardId,
  filing: DashboardFiling,
): Promise<EvidenceChain> {
  const documentIds = [
    filing.receiptDocumentId,
    filing.stagedPacketDocumentId,
    ...(filing.sourceDocumentIds ?? []),
  ].filter(Boolean) as DashboardId[];
  const [documents, submitter, auditEvents] = await Promise.all([
    Promise.all(documentIds.map((id) => ctx.db.get(id))),
    filing.submittedByUserId ? ctx.db.get(filing.submittedByUserId) : Promise.resolve(null),
    ctx.db
      .query("activity")
      .withIndex("by_entity", (q) => q.eq("societyId", societyId).eq("entityType", "filing").eq("entityId", filing._id))
      .collect(),
  ]);
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
