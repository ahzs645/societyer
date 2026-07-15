/**
 * PORTABLE FUNCTIONS: the dashboard domain (navCounts / summary).
 *
 * Reads `members / directors / meetings / filings / deadlines / conflicts /
 * committees / goals / tasks / complianceRemediations / activity` (and the
 * society + linked documents/users) over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * Pure helpers from `convex/lib/dashboardComplianceRules.ts` (the rule pack +
 * `evaluateDashboardComplianceRules`) are inlined here because that module is
 * pure and dependency-free. The bylaw-rule resolution (`getActiveBylawRuleSet`)
 * is a portable copy of the pure `ctx.db`-only logic from
 * `convex/lib/bylawRules.ts` (that module imports `_generated`, so its logic is
 * inlined on the portable contract rather than reaching into the Convex lib).
 */

import type { PortableDoc, PortableQueryCtx } from "../portable/ctx";

/* ----------------------- compliance rules (inlined) ---------------------- */

type ComplianceFlagLevel = "ok" | "warn" | "err";

type DashboardRemediationAction = {
  id: string;
  label: string;
  intent: string;
  to?: string;
};

type DashboardComplianceFlag = {
  ruleId: string;
  level: ComplianceFlagLevel;
  text: string;
  citationId?: string;
  citationIds?: string[];
  evidenceRequired: string[];
  remediationActions: DashboardRemediationAction[];
  remediationStatus?: string;
  remediationTaskId?: string;
  remediationUpdatedAtISO?: string;
};

type ComplianceSociety = {
  isMemberFunded: boolean;
  privacyPolicyDocId?: string;
  privacyProgramStatus?: string;
  memberDataAccessStatus?: string;
  memberDataGapDocumented?: boolean;
  constitutionDocId?: string;
  bylawsDocId?: string;
};

type ComplianceDirector = {
  consentOnFile: boolean;
  isBCResident: boolean;
};

type DashboardComplianceContext = {
  society: ComplianceSociety | null;
  activeDirectors: ComplianceDirector[];
  rulesConfigured: boolean;
};

type DashboardComplianceRule = {
  id: string;
  jurisdiction: string;
  societyType: string;
  effectiveDate: string;
  ruleText: string;
  citation: string;
  evidenceRequired: string[];
  remediationActions: DashboardRemediationAction[];
  passFail: (context: DashboardComplianceContext) => DashboardComplianceFlag | null;
  fixtures: any[];
};

type DashboardComplianceRulePack = {
  id: string;
  version: number;
  jurisdiction: string;
  societyType: string;
  effectiveDate: string;
  source: string;
  rules: DashboardComplianceRule[];
};

const compliantSociety: ComplianceSociety = {
  isMemberFunded: false,
  privacyPolicyDocId: "doc_privacy",
  privacyProgramStatus: "Documented",
  memberDataAccessStatus: "Society-controlled",
  memberDataGapDocumented: true,
  constitutionDocId: "doc_constitution",
  bylawsDocId: "doc_bylaws",
};

const compliantDirector: ComplianceDirector = {
  consentOnFile: true,
  isBCResident: true,
};

const compliantContext: DashboardComplianceContext = {
  society: compliantSociety,
  activeDirectors: [
    compliantDirector,
    { ...compliantDirector },
    { ...compliantDirector },
  ],
  rulesConfigured: true,
};

function flag(
  rule: Pick<DashboardComplianceRule, "id" | "evidenceRequired" | "remediationActions">,
  args: Omit<DashboardComplianceFlag, "ruleId" | "evidenceRequired" | "remediationActions">,
): DashboardComplianceFlag {
  return {
    ruleId: rule.id,
    evidenceRequired: rule.evidenceRequired,
    remediationActions: rule.remediationActions,
    ...args,
  };
}

function baseFixture(
  overrides: Partial<DashboardComplianceContext>,
): DashboardComplianceContext {
  return {
    ...compliantContext,
    ...overrides,
    society:
      overrides.society === undefined
        ? compliantContext.society
        : overrides.society,
    activeDirectors:
      overrides.activeDirectors ?? compliantContext.activeDirectors,
  };
}

const bcSocietiesDashboardComplianceRulePack: DashboardComplianceRulePack = {
  id: "bc-societies-dashboard-compliance",
  version: 1,
  jurisdiction: "BC",
  societyType: "society",
  effectiveDate: "2016-11-28",
  source: "Existing Societyer dashboard checks; verify citations against current law before relying on them.",
  rules: [
    {
      id: "BC-SOC-DIRECTORS-MIN",
      jurisdiction: "BC",
      societyType: "non-member-funded society",
      effectiveDate: "2016-11-28",
      ruleText: "Non-member-funded societies should have at least three active directors.",
      citation: "Societies Act ss.40, 197",
      evidenceRequired: ["Active director register", "Society member-funded status"],
      remediationActions: [
        { id: "open-directors", label: "Update directors", intent: "navigate", to: "/app/directors" },
        { id: "open-society-type", label: "Check society type", intent: "navigate", to: "/app/society" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if (!context.society.isMemberFunded && context.activeDirectors.length < 3) {
          return flag(this, {
            level: "err",
            text: "Fewer than 3 active directors (s.40 Societies Act; s.197 member-funded exception).",
            citationId: "BC-SOC-DIRECTORS-MIN",
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags a non-member-funded society with fewer than three active directors",
          context: baseFixture({ activeDirectors: [compliantDirector, { ...compliantDirector }] }),
          expectedLevel: "err",
        },
        {
          name: "passes a member-funded society with fewer than three active directors",
          context: baseFixture({
            society: { ...compliantSociety, isMemberFunded: true },
            activeDirectors: [compliantDirector, { ...compliantDirector }],
          }),
          expectedLevel: null,
        },
      ],
    },
    {
      id: "BC-SOC-DIRECTORS-BC-RESIDENT",
      jurisdiction: "BC",
      societyType: "non-member-funded society",
      effectiveDate: "2016-11-28",
      ruleText: "Non-member-funded societies should have at least one active director recorded as ordinarily resident in BC.",
      citation: "Societies Act ss.40, 197",
      evidenceRequired: ["Active director register", "Director residency field", "Society member-funded status"],
      remediationActions: [
        { id: "open-directors", label: "Update residency", intent: "navigate", to: "/app/directors" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if (context.society.isMemberFunded) return null;
        if (!context.activeDirectors.some((director) => director.isBCResident)) {
          return flag(this, {
            level: "err",
            text: "No BC-resident director on record (s.40 Societies Act; s.197 member-funded exception).",
            citationId: "BC-SOC-DIRECTORS-BC-RESIDENT",
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags no BC-resident director",
          context: baseFixture({
            activeDirectors: compliantContext.activeDirectors.map((director) => ({
              ...director,
              isBCResident: false,
            })),
          }),
          expectedLevel: "err",
        },
        {
          name: "passes a member-funded society with no BC-resident director",
          context: baseFixture({
            society: { ...compliantSociety, isMemberFunded: true },
            activeDirectors: compliantContext.activeDirectors.map((director) => ({
              ...director,
              isBCResident: false,
            })),
          }),
          expectedLevel: null,
        },
      ],
    },
    {
      id: "BC-SOC-DIRECTOR-CONSENT",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "Director consent evidence should be on file for active directors.",
      citation: "Societies Act s.42 director consent requirements",
      evidenceRequired: ["Active director register", "Written consent or meeting-attendance/non-refusal evidence"],
      remediationActions: [
        { id: "open-directors", label: "Update consent", intent: "navigate", to: "/app/directors" },
        { id: "upload-evidence", label: "Upload evidence", intent: "navigate", to: "/app/documents" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        const missingConsent = context.activeDirectors.filter((director) => !director.consentOnFile);
        if (missingConsent.length > 0) {
          return flag(this, {
            level: "warn",
            text: `${missingConsent.length} director(s) missing consent evidence.`,
            citationId: "BC-SOC-DIRECTOR-CONSENT",
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags active directors missing consent",
          context: baseFixture({
            activeDirectors: [
              compliantDirector,
              { ...compliantDirector, consentOnFile: false },
              { ...compliantDirector, consentOnFile: false },
            ],
          }),
          expectedLevel: "warn",
        },
      ],
    },
    {
      id: "PIPA-POLICY-DOCUMENTED",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2004-01-01",
      ruleText: "Privacy policy and practices should be marked documented.",
      citation: "Personal Information Protection Act",
      evidenceRequired: ["Privacy program status"],
      remediationActions: [
        { id: "create-policy-template", label: "Create from template", intent: "createPipaPolicyDraft" },
        { id: "open-privacy-workflow", label: "Open PIPA workflow", intent: "navigate", to: "/app/privacy" },
        { id: "assign-review", label: "Assign review", intent: "createPrivacyReviewTask" },
        { id: "mark-reviewed", label: "Mark reviewed", intent: "markPrivacyProgramReviewed" },
      ],
      passFail(context) {
        if (!context.society) return null;
        const status = context.society.privacyProgramStatus ?? (context.society.privacyPolicyDocId ? "Documented" : "Unknown");
        if (status !== "Documented") {
          return flag(this, {
            level: "warn",
            text: "Privacy policy/practices are not marked documented.",
            citationId: "PIPA-POLICY",
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags undocumented privacy practices",
          context: baseFixture({
            society: { ...compliantSociety, privacyProgramStatus: "Needs review" },
          }),
          expectedLevel: "warn",
        },
      ],
    },
    {
      id: "PIPA-POLICY-EVIDENCE",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2004-01-01",
      ruleText: "Privacy policy evidence should be linked in the document repository.",
      citation: "Personal Information Protection Act",
      evidenceRequired: ["Linked privacy policy document"],
      remediationActions: [
        { id: "upload-policy", label: "Upload policy", intent: "navigate", to: "/app/documents" },
        { id: "create-policy-template", label: "Create from template", intent: "createPipaPolicyDraft" },
        { id: "assign-review", label: "Assign review", intent: "createPrivacyReviewTask" },
        { id: "mark-reviewed", label: "Mark reviewed", intent: "markPrivacyProgramReviewed" },
        { id: "link-board-minutes", label: "Link board approval minutes", intent: "navigate", to: "/app/policies" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if (!context.society.privacyPolicyDocId) {
          return flag(this, {
            level: "warn",
            text: "No PIPA policy evidence linked; this is a document-evidence gap, not a registry requirement.",
            citationId: "PIPA-POLICY",
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags missing privacy policy evidence",
          context: baseFixture({
            society: { ...compliantSociety, privacyPolicyDocId: undefined },
          }),
          expectedLevel: "warn",
        },
      ],
    },
    {
      id: "MEMBER-DATA-ACCESS-STATUS",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "Member data access status should be documented.",
      citation: "Societies Act records requirements and PIPA",
      evidenceRequired: ["Member data access status"],
      remediationActions: [
        { id: "open-privacy-workflow", label: "Open PIPA workflow", intent: "navigate", to: "/app/privacy" },
        { id: "open-society-data-access", label: "Record data access", intent: "navigate", to: "/app/society" },
        { id: "create-member-data-memo", label: "Create data memo", intent: "createMemberDataGapMemoDraft" },
        { id: "assign-review", label: "Assign review", intent: "createPrivacyReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if ((context.society.memberDataAccessStatus ?? "Unknown") === "Unknown") {
          return flag(this, {
            level: "warn",
            text: "Member data access status is not documented.",
            citationIds: ["PIPA-POLICY", "BC-SOC-RECORDS"],
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags unknown member data access status",
          context: baseFixture({
            society: { ...compliantSociety, memberDataAccessStatus: "Unknown" },
          }),
          expectedLevel: "warn",
        },
      ],
    },
    {
      id: "MEMBER-DATA-GAP-MEMO",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "When member data is not fully controlled by the society, the access gap should be documented.",
      citation: "Societies Act records requirements and PIPA",
      evidenceRequired: ["Member data access status", "Gap memo or equivalent document"],
      remediationActions: [
        { id: "create-member-data-memo", label: "Create data memo", intent: "createMemberDataGapMemoDraft" },
        { id: "open-privacy-workflow", label: "Open PIPA workflow", intent: "navigate", to: "/app/privacy" },
        { id: "assign-review", label: "Assign review", intent: "createPrivacyReviewTask" },
        { id: "mark-reviewed", label: "Mark reviewed", intent: "markMemberDataAccessReviewed" },
      ],
      passFail(context) {
        if (!context.society) return null;
        const status = context.society.memberDataAccessStatus ?? "Unknown";
        const requiresMemo = status === "Institution-held" || status === "Partially available";
        if (requiresMemo && !context.society.memberDataGapDocumented) {
          return flag(this, {
            level: "warn",
            text: "Member list not fully controlled by society; document the data-access gap.",
            citationIds: ["PIPA-POLICY", "BC-SOC-RECORDS"],
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags undocumented institution-held member data",
          context: baseFixture({
            society: {
              ...compliantSociety,
              memberDataAccessStatus: "Institution-held",
              memberDataGapDocumented: false,
            },
          }),
          expectedLevel: "warn",
        },
      ],
    },
    {
      id: "BC-SOC-CONSTITUTION-EVIDENCE",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "Constitution evidence should be uploaded.",
      citation: "Societies Act records requirements",
      evidenceRequired: ["Linked constitution document"],
      remediationActions: [
        { id: "upload-constitution", label: "Upload constitution", intent: "navigate", to: "/app/society" },
        { id: "open-documents", label: "Documents", intent: "navigate", to: "/app/documents" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if (!context.society.constitutionDocId) {
          return flag(this, {
            level: "warn",
            text: "Constitution not uploaded.",
            citationId: "BC-SOC-RECORDS",
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags missing constitution evidence",
          context: baseFixture({
            society: { ...compliantSociety, constitutionDocId: undefined },
          }),
          expectedLevel: "warn",
        },
      ],
    },
    {
      id: "BC-SOC-BYLAWS-EVIDENCE",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "Bylaws evidence should be uploaded.",
      citation: "Societies Act records requirements",
      evidenceRequired: ["Linked bylaws document"],
      remediationActions: [
        { id: "upload-bylaws", label: "Upload bylaws", intent: "navigate", to: "/app/society" },
        { id: "open-documents", label: "Documents", intent: "navigate", to: "/app/documents" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if (!context.society.bylawsDocId) {
          return flag(this, {
            level: "warn",
            text: "Bylaws not uploaded.",
            citationId: "BC-SOC-RECORDS",
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags missing bylaws evidence",
          context: baseFixture({
            society: { ...compliantSociety, bylawsDocId: undefined },
          }),
          expectedLevel: "warn",
        },
      ],
    },
    {
      id: "BYLAW-RULE-SET-CONFIGURED",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "A bylaw rule set should be configured so governance workflows are not using defaults.",
      citation: "Society bylaws and BC model bylaws",
      evidenceRequired: ["Active bylaw rule set"],
      remediationActions: [
        { id: "open-bylaw-rules", label: "Configure rules", intent: "navigate", to: "/app/bylaw-rules" },
        { id: "upload-bylaws", label: "Upload bylaws", intent: "navigate", to: "/app/society" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if (!context.rulesConfigured) {
          return flag(this, {
            level: "warn",
            text: "Bylaw rule set not configured - governance workflows are using BC defaults.",
            citationId: "BC-SOC-MODEL-BYLAWS-QUORUM",
          });
        }
        return null;
      },
      fixtures: [
        {
          name: "flags fallback bylaw rules",
          context: baseFixture({ rulesConfigured: false }),
          expectedLevel: "warn",
        },
      ],
    },
  ],
};

function evaluateDashboardComplianceRules(
  context: DashboardComplianceContext,
  rulePack: DashboardComplianceRulePack = bcSocietiesDashboardComplianceRulePack,
): DashboardComplianceFlag[] {
  const flags = rulePack.rules.flatMap((rule) => {
    const result = rule.passFail(context);
    return result ? [result] : [];
  });

  if (flags.length === 0 && context.society) {
    return [
      {
        ruleId: "DASHBOARD-COMPLIANCE-OK",
        level: "ok",
        text: "No compliance issues detected.",
        evidenceRequired: [],
        remediationActions: [
          { id: "open-evidence", label: "Review evidence", intent: "navigate", to: "/app/documents" },
        ],
      },
    ];
  }

  return flags;
}

/* ------------------ bylaw-rule resolution (inlined, pure) ---------------- */

const DEFAULT_BYLAW_RULES = {
  societyId: "placeholder",
  version: 1,
  status: "Active",
  generalNoticeMinDays: 14,
  generalNoticeMaxDays: 60,
  allowElectronicMeetings: true,
  allowHybridMeetings: true,
  allowElectronicVoting: false,
  allowProxyVoting: false,
  proxyHolderMustBeMember: false,
  proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "percentage",
  quorumValue: 10,
  quorumMinimumCount: 3,
  memberProposalThresholdPct: 5,
  memberProposalMinSignatures: 1,
  memberProposalLeadDays: 7,
  requisitionMeetingThresholdPct: 10,
  annualReportDueDaysAfterMeeting: 30,
  requireAgmFinancialStatements: true,
  requireAgmElections: true,
  ballotIsAnonymous: true,
  voterMustBeMemberAtRecordDate: true,
  inspectionMemberRegisterByMembers: true,
  inspectionMemberRegisterByPublic: false,
  inspectionDirectorRegisterByMembers: true,
  inspectionCopiesAllowed: true,
  ordinaryResolutionThresholdPct: 50,
  specialResolutionThresholdPct: 66.67,
  unanimousWrittenSpecialResolution: true,
  updatedAtISO: new Date(0).toISOString(),
};

function getDefaultBylawRules(societyId: string) {
  return {
    ...DEFAULT_BYLAW_RULES,
    societyId,
    updatedAtISO: new Date().toISOString(),
  };
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
  if (selected) return selected;
  return {
    ...getDefaultBylawRules(societyId),
    isFallback: true,
  };
}

async function getActiveBylawRuleSet(ctx: PortableQueryCtx, societyId: string) {
  return getBylawRuleSetForDate(ctx, societyId, new Date().toISOString());
}

function compareRuleSetsDesc(a: any, b: any) {
  const byEffective = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (byEffective !== 0) return byEffective;
  return b.version - a.version;
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
  privacyPolicyDocId?: string;
  privacyProgramStatus?: string;
  memberDataAccessStatus?: string;
  memberDataGapDocumented?: boolean;
  constitutionDocId?: string;
  bylawsDocId?: string;
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

/* ------------------------------- handlers -------------------------------- */

export async function navCountsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const nowDate = new Date();
  const nowISO = nowDate.toISOString();
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
    ctx.db.query("members").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
    ctx.db.query("directors").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
    ctx.db.query("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", yearStartISO).lt("scheduledAt", nextYearStartISO)).collect(),
    ctx.db.query("filings").withIndex("by_society_due", (q) => q.eq("societyId", societyId).lt("dueDate", nowISO)).collect(),
    ctx.db.query("deadlines").withIndex("by_society_done", (q) => q.eq("societyId", societyId).eq("done", false)).collect(),
    ctx.db.query("conflicts").withIndex("by_society_resolved", (q) => q.eq("societyId", societyId).eq("resolvedAt", undefined)).collect(),
    ctx.db.query("committees").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
    collectStatuses(ctx, "goals", societyId, OPEN_GOAL_STATUSES),
    collectStatuses(ctx, "tasks", societyId, OPEN_TASK_STATUSES),
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
    openTasks: tasks.length,
  };
}

export async function summaryPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
): Promise<DashboardSummary> {
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
    ctx.db.get<SocietyRecord>(societyId),
    ctx.db.query("members").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
    ctx.db.query<any>("directors").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
    ctx.db.query<DashboardMeeting & PortableDoc>("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", yearStartISO).lt("scheduledAt", nextYearStartISO)).collect(),
    ctx.db.query<DashboardMeeting & PortableDoc>("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", nowISO)).take(PREVIEW_SCAN_LIMIT),
    ctx.db.query<DashboardFiling & PortableDoc>("filings").withIndex("by_society_due", (q) => q.eq("societyId", societyId).lt("dueDate", nowISO)).collect(),
    ctx.db.query<DashboardFiling & PortableDoc>("filings").withIndex("by_society_due", (q) => q.eq("societyId", societyId).gte("dueDate", nowISO)).take(PREVIEW_SCAN_LIMIT),
    ctx.db.query<DashboardFiling & PortableDoc>("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("deadlines").withIndex("by_society_done", (q) => q.eq("societyId", societyId).eq("done", false)).collect(),
    ctx.db.query("conflicts").withIndex("by_society_resolved", (q) => q.eq("societyId", societyId).eq("resolvedAt", undefined)).collect(),
    ctx.db.query("committees").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect(),
    collectStatuses(ctx, "goals", societyId, OPEN_GOAL_STATUSES),
    collectStatuses(ctx, "tasks", societyId, OPEN_TASK_STATUSES),
    ctx.db.query("complianceRemediations").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    getActiveBylawRuleSet(ctx, societyId),
  ]);

  const bcResidents = activeDirectors.filter((d) => d.isBCResident).length;
  // Board roster for the overview card — officers (chair/president/etc.) first,
  // then the rest alphabetically, capped so the card stays glanceable.
  const officerRank = (position: string): number =>
    /chair|president/i.test(position) ? 0
    : /vice|treasurer|secretary/i.test(position) ? 1
    : 2;
  const board: DashboardBoardMember[] = [...activeDirectors]
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
  const openTaskPreview = tasks
    .sort((a, b) => compareOptionalDates(a.dueDate, b.dueDate))
    .slice(0, 6);
  const evidenceChains = await buildEvidenceChains(ctx, societyId, filingRows);
  const remediationByRuleId = new Map(
    complianceRemediations
      .sort((a, b) => String(b.updatedAtISO ?? "").localeCompare(String(a.updatedAtISO ?? "")))
      .map((row: Record<string, any>) => [row.ruleId, row]),
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
    activeDirectors: activeDirectors.map((director: Record<string, any>) => ({
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
    Promise.all(documentIds.map((id) => ctx.db.get(id))),
    filing.submittedByUserId ? ctx.db.get(filing.submittedByUserId) : Promise.resolve(null),
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
