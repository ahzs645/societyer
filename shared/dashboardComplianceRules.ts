/**
 * Dashboard compliance rules (pure, dependency-free).
 *
 * Shared by the portable dashboard summary (`shared/functions/dashboard.ts`),
 * which runs on hosted Convex, the local Dexie runtime and the convex-test
 * oracle, and by `convex/lib/dashboardComplianceRules.ts` (a re-export kept for
 * existing imports).
 *
 * Every rule declares the organizations it is written for (`audience`). The
 * pack is BC-society-first: its Societies Act rules must never reach a
 * corporation or a society formed outside BC, and the BC PIPA rules reach only
 * BC-home organizations. Use `dashboardComplianceRulePackForOrganization` to get
 * the rules that apply to a workspace; do not evaluate the full pack directly.
 */
import { legalGovernanceProfile, LEGAL_GOVERNANCE_PROFILES, minimumLegalDirectors, requiredResidentCanadianDirectors, type GovernanceOrganization } from "./legalGovernanceProfiles";
import { resolvePrivacyProfile, hasApplicablePrivacyLaw, PRIVACY_LAWS, type PrivacyAssessmentFacts } from "./privacyRuleProfiles";
import type { LegalEntityLike } from "./organizationDomain";
import { audienceAppliesToOrganization, type RuleAudience } from "./entityRuleScope";

export type ComplianceFlagLevel = "ok" | "warn" | "err";

export type DashboardRemediationAction = {
  id: string;
  label: string;
  intent: string;
  to?: string;
};

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

export type ComplianceSociety = GovernanceOrganization & PrivacyAssessmentFacts & {
  privacyOfficerName?: string;
  privacyOfficerEmail?: string;
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
  residentCanadianStatus?: "yes" | "no" | "unknown";
};

export type DashboardComplianceContext = {
  society: ComplianceSociety | null;
  activeDirectors: ComplianceDirector[];
  rulesConfigured: boolean;
};

export type DashboardComplianceRule = {
  id: string;
  /** Which organizations the rule is written for; see shared/entityRuleScope.ts. */
  audience: RuleAudience;
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

export type RuleFixture = {
  name: string;
  context: DashboardComplianceContext;
  expectedLevel: ComplianceFlagLevel | null;
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
      audience: "bc_society",
      jurisdiction: "BC",
      societyType: "society, with a member-funded exception",
      effectiveDate: "2016-11-28",
      ruleText: "Ordinary societies need at least three directors; member-funded societies need at least one.",
      citation: "Societies Act ss.40, 197",
      evidenceRequired: ["Active director register", "Society member-funded status"],
      remediationActions: [
        { id: "open-directors", label: "Update directors", intent: "navigate", to: "/app/directors" },
        { id: "open-society-type", label: "Check society type", intent: "navigate", to: "/app/society" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if (context.activeDirectors.length < (context.society.isMemberFunded ? 1 : 3)) {
          return flag(this, {
            level: "err",
            text: context.society.isMemberFunded ? "No active director recorded; a member-funded society needs at least one director (s. 197)." : "Fewer than 3 active directors recorded (Societies Act s. 40).",
            citationId: context.society.isMemberFunded ? "BC-SOC-MEMBER-FUNDED-DIRECTORS" : "BC-SOC-DIRECTORS-MIN",
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
      audience: "bc_society",
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
      audience: "bc_society",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "Director consent evidence should be on file for active directors.",
      citation: "Societies Act s.42 director consent requirements",
      evidenceRequired: ["Active director register", "Written consent or meeting-attendance/non-refusal evidence"],
      remediationActions: [
        { id: "open-directors", label: "Update consent", intent: "navigate", to: "/app/directors?intent=consent" },
        { id: "upload-evidence", label: "Upload evidence", intent: "navigate", to: "/app/documents?intent=new&category=Governance&title=Director%20consent" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        const missingConsent = context.activeDirectors.filter((director) => !director.consentOnFile);
        if (missingConsent.length > 0) {
          return flag(this, {
            level: "warn",
            text: `${missingConsent.length} ${missingConsent.length === 1 ? "director is" : "directors are"} missing consent evidence.`,
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
      audience: "bc_organization",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2004-01-01",
      ruleText: "Privacy policy and practices should be marked documented.",
      citation: "Personal Information Protection Act",
      evidenceRequired: ["Privacy program status"],
      remediationActions: [
        { id: "create-policy-template", label: "Create from template", intent: "createPipaPolicyDraft" },
        { id: "open-privacy-workflow", label: "Open privacy workflow", intent: "navigate", to: "/app/privacy" },
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
      audience: "bc_organization",
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
      audience: "bc_society",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "Member data access status should be documented.",
      citation: "Societies Act records requirements; privacy law requires a separate activity assessment",
      evidenceRequired: ["Member data access status"],
      remediationActions: [
        { id: "open-privacy-workflow", label: "Open privacy workflow", intent: "navigate", to: "/app/privacy" },
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
      audience: "bc_society",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2016-11-28",
      ruleText: "When member data is not fully controlled by the society, the access gap should be documented.",
      citation: "Societies Act records requirements; privacy law requires a separate activity assessment",
      evidenceRequired: ["Member data access status", "Gap memo or equivalent document"],
      remediationActions: [
        { id: "create-member-data-memo", label: "Create data memo", intent: "createMemberDataGapMemoDraft" },
        { id: "open-privacy-workflow", label: "Open privacy workflow", intent: "navigate", to: "/app/privacy" },
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
      audience: "bc_society",
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
      audience: "bc_society",
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
      audience: "bc_society",
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
  complete = true,
): DashboardComplianceFlag[] {
  const flags = rulePack.rules.flatMap((rule) => {
    const result = rule.passFail(context);
    return result ? [result] : [];
  });

  if (complete && flags.length === 0 && context.society && rulePack.rules.length > 0) {
    return [
      {
        ruleId: "DASHBOARD-COMPLIANCE-OK",
        level: "ok",
        text: "No gaps detected in the configured evidence checks. This does not certify overall legal compliance.",
        evidenceRequired: [],
        remediationActions: [
          { id: "open-evidence", label: "Review evidence", intent: "navigate", to: "/app/documents" },
        ],
      },
    ];
  }

  return flags;
}

/** The dashboard rules that apply to this organization (entity type + home jurisdiction). */
export function dashboardComplianceRulePackForOrganization(
  organization?: LegalEntityLike | null,
  rulePack: DashboardComplianceRulePack = bcSocietiesDashboardComplianceRulePack,
): DashboardComplianceRulePack {
  return {
    ...rulePack,
    rules: [...rulePack.rules, ...(rulePack === bcSocietiesDashboardComplianceRulePack ? extendedDashboardRules(organization) : [])]
      .filter((rule) => audienceAppliesToOrganization(rule.audience, organization))
      .map((rule) => ({ ...rule, passFail(context) {
        const result = rule.passFail(context);
        if (!result || hasApplicablePrivacyLaw(organization, "bc_pipa")) return result;
        return { ...result, citationId: result.citationId?.startsWith("PIPA-") ? undefined : result.citationId,
          ...(result.citationIds ? { citationIds: result.citationIds.filter((id) => !id.startsWith("PIPA-")) } : {}) };
      } })),
  };
}


/** Corporate profiles reuse one evaluator; source IDs, minima and exceptions are data. */
function extendedDashboardRules(organization?: LegalEntityLike | null): DashboardComplianceRule[] {
  if (!organization) return [];
  const out: DashboardComplianceRule[] = [];
  const profile = legalGovernanceProfile(organization);
  const make = (id: string, text: string, citationIds: readonly string[], audience: RuleAudience, check: (context: DashboardComplianceContext) => { text: string; level: ComplianceFlagLevel } | null, to = "/app/directors"): DashboardComplianceRule => ({
    id, audience, jurisdiction: profile?.jurisdictionCode ?? "CA", societyType: profile?.name ?? "organization", effectiveDate: "2026-10-11",
    ruleText: text, citation: citationIds.join(", ") || "Applicability assessment; no statutory conclusion",
    evidenceRequired: ["Current legal identity and authoritative register or document evidence"],
    remediationActions: [{ id: "review-evidence", label: "Review evidence", intent: "navigate", to }],
    passFail(context) { const result = check(context); return result ? flag(this, { ...result, citationIds: [...citationIds] }) : null; },
    fixtures: [],
  });
  if (profile?.kind === 'corporation') {
    const audience: RuleAudience = `governance:${profile.id}`;
    out.push(make(`LEGAL-${profile.id}-DIRECTORS-MIN`, 'Minimum directors in the active register', profile.directors.sourceIds, audience, ctx => {
      const minimum = minimumLegalDirectors(ctx.society) ?? profile.directors.minimum;
      return ctx.activeDirectors.length < minimum ? { level: 'err', text: `Fewer than ${minimum} active legal directors are recorded for this ${profile.name}. Confirm the register and applicable articles.` } : null;
    }));
    out.push(make(`LEGAL-${profile.id}-DIRECTOR-CONSENT`, 'Director consent evidence', profile.directors.consentSourceIds, audience, ctx => {
      const missing = ctx.activeDirectors.filter(d => !d.consentOnFile).length;
      return missing ? { level: 'warn', text: `${missing} director${missing === 1 ? '' : 's'} lack linked consent evidence. ${profile.directors.consent}` } : null;
    }));
    if (profile.directors.residency === 'canadian_25_percent') out.push(make(`LEGAL-${profile.id}-DIRECTORS-RESIDENCY`, 'Resident Canadian director requirement', profile.directors.sourceIds, audience, ctx => {
      const required = requiredResidentCanadianDirectors(ctx.activeDirectors.length);
      const confirmed = ctx.activeDirectors.filter(d => d.residentCanadianStatus === 'yes').length;
      const unknown = ctx.activeDirectors.filter(d => !d.residentCanadianStatus || d.residentCanadianStatus === 'unknown').length;
      return confirmed < required ? { level: unknown ? 'warn' : 'err', text: `${confirmed} confirmed resident Canadian director${confirmed === 1 ? '' : 's'}; at least ${required} required for the recorded board. ${unknown ? `${unknown} residency assessment${unknown === 1 ? '' : 's'} outstanding. ` : ''}Review stricter regulated-sector exceptions.` } : null;
    }));
    out.push(make(`LEGAL-${profile.id}-CLASSIFICATION`, 'Public/private classification', profile.directors.sourceIds, audience, ctx => ctx.society?.distributing === undefined ? { level: 'warn', text: 'Confirm the applicable public, distributing or offering classification; director minima and governance exceptions depend on it.' } : null, '/app/society'));
    out.push(make(`LEGAL-${profile.id}-GOVERNING-DOCUMENTS`, 'Governing-document evidence', profile.records[0]?.sourceIds ?? [], audience, ctx => !ctx.society?.bylawsDocId && !ctx.society?.constitutionDocId ? { level: 'warn', text: `Link the current ${profile.id === 'bc_company' ? 'articles and notice of articles' : 'articles and by-laws'} and review the entity-specific minute-book checklist.` } : null, '/app/minute-book'));
  }
  const privacy = resolvePrivacyProfile(organization);
  // A BC-home workspace has BC PIPA presumed (privacy.md); the warning asks it
  // to confirm the displacing facts rather than implying no law is identified.
  const privacyApplicabilityText = privacy.presumedLawIds.includes('bc_pipa')
    ? 'BC PIPA is presumed to apply to this BC organization. Confirm the facts that could displace it (federal work, undertaking or business; health or public-sector records; operations outside BC) to finalize the privacy assessment.'
    : 'Assess privacy law using operating locations and activities. Incorporation jurisdiction alone does not establish which privacy duties apply.';
  out.push(make('PRIVACY-APPLICABILITY', 'Assess privacy applicability', [], 'general', () => privacy.status !== 'assessed' && privacy.status !== 'no-general-law-identified' ? { level: 'warn', text: privacyApplicabilityText } : null, '/app/privacy'));
  for (const lawId of privacy.applicableLawIds) {
    const law = PRIVACY_LAWS[lawId];
    const audience: RuleAudience = `privacy:${lawId}`;
    const officerSources = law.rules.find(r => r.key === 'officer')?.citationIds ?? [];
    out.push(make(`PRIVACY-${lawId}-OFFICER`, 'Accountable privacy person', officerSources, audience, ctx => !ctx.society?.privacyOfficerName ? { level: 'warn', text: `No accountable privacy person is recorded for ${law.label}.` } : null, '/app/privacy'));
    if (lawId !== 'bc_pipa') {
      const sources = law.rules.find(r => r.key === 'policy')?.citationIds ?? [];
      out.push(make(`PRIVACY-${lawId}-POLICY`, 'Privacy practices and policy evidence', sources, audience, ctx => !ctx.society?.privacyPolicyDocId || ctx.society?.privacyProgramStatus !== 'Documented' ? { level: 'warn', text: `Review and link the documented policy and practices for ${law.label}. A document upload alone does not establish compliance.` } : null, '/app/privacy'));
    }
  }
  return out;
}
