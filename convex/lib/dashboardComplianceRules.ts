export type ComplianceFlagLevel = "ok" | "warn" | "err";

export type DashboardComplianceFlag = {
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

export type DashboardRemediationAction = {
  id: string;
  label: string;
  intent: string;
  to?: string;
};

export type ComplianceSociety = {
  isMemberFunded: boolean;
  privacyPolicyDocId?: string;
  privacyProgramStatus?: string;
  memberDataAccessStatus?: string;
  memberDataGapDocumented?: boolean;
  constitutionDocId?: string;
  bylawsDocId?: string;
};

export type ComplianceDirector = {
  consentOnFile: boolean;
  isBCResident: boolean;
};

export type DashboardComplianceContext = {
  society: ComplianceSociety | null;
  activeDirectors: ComplianceDirector[];
  rulesConfigured: boolean;
};

export type RuleFixture = {
  name: string;
  context: DashboardComplianceContext;
  expectedLevel: ComplianceFlagLevel | null;
};

export type DashboardComplianceRule = {
  id: string;
  jurisdiction: string;
  societyType: string;
  effectiveDate: string;
  ruleText: string;
  citation: string;
  evidenceRequired: string[];
  remediationActions: DashboardRemediationAction[];
  passFail: (context: DashboardComplianceContext) => DashboardComplianceFlag | null;
  fixtures: RuleFixture[];
};

export type DashboardComplianceRulePack = {
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

export const bcSocietiesDashboardComplianceRulePack: DashboardComplianceRulePack = {
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

export function evaluateDashboardComplianceRules(
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
