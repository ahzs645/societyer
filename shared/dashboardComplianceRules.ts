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
import type { DashboardItemAcknowledgement, DashboardItemDismissal, DashboardItemSnooze } from "./dashboardDismissals";
import type { RequirementBasis } from "./dashboardFindingPolicy";
import { consentStateSatisfied, unverifiedConsentSentence, type DirectorConsentState } from "./directorConsentRecords";
import {
  attestationLine,
  governingDocumentCurrentness,
  governingEvidenceHref,
  hasIdentifiedEvidence,
  privacyProgramAssessment,
  shortText,
  type EvidenceFacts,
  type EvidenceField,
  type GoverningDocumentEvidenceEntry,
  type GoverningDocumentVerification,
  type PrivacyProgramReview,
} from "./governingDocumentEvidence";

/** `info` is a neutral status note (e.g. "isn't incorporated yet"): not a pass and not a gap. */
export type ComplianceFlagLevel = "ok" | "info" | "warn" | "err";

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
  /** What the flag rests on (shared/dashboardFindingPolicy.ts); absent for an unclassified rule. */
  requirementBasis?: RequirementBasis;
  /** Rule version + what the flag is about; dismissals and acknowledgements hold only while it matches. */
  subjectKey?: string;
  /** A recommendation ("warn"/"info") this workspace may dismiss; see shared/dashboardDismissals.ts. */
  dismissable?: boolean;
  /** Set while the flag is dismissed at its current level and subject. */
  dismissal?: DashboardItemDismissal;
  /** Set while an acknowledgement applies to the flag's current subject; the flag stays outstanding. */
  acknowledgement?: DashboardItemAcknowledgement;
  /** Set while a requirement's reminders are snoozed; it stays listed and counted. */
  snooze?: DashboardItemSnooze;
  /** The open follow-up task's owner and due date, when one is assigned. */
  followUp?: { assignee?: string; dueDate?: string };
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
  /** Authoritative copies held outside Societyer; see shared/governingDocumentEvidence.ts. */
  governingDocumentEvidence?: GoverningDocumentEvidenceEntry[];
  governingDocumentVerifications?: GoverningDocumentVerification[];
  privacyProgramReview?: PrivacyProgramReview;
};

export type ComplianceDirector = {
  /** Consent evidence state from the consent register; only `verified` satisfies the consent rules. */
  consentState: DirectorConsentState;
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

const heldElsewhereHref = (field: EvidenceField) => governingEvidenceHref("held-elsewhere", field);
const PRIVACY_REVIEW_HREF = governingEvidenceHref("privacy-review", "privacyPolicyDocId");

const FIXTURE_RECORDED_AT = "2026-01-15T17:00:00.000Z";

const compliantPrivacyReview: PrivacyProgramReview = {
  policiesReviewed: "Privacy policy, complaint process, access and correction procedure",
  versionOrEffectiveDate: "v2, effective 2026-01-01",
  maintainedAt: "Documents > Policies",
  reviewedOn: "2026-01-15",
  reviewedAtISO: FIXTURE_RECORDED_AT,
  reviewedByName: "Fixture reviewer",
};

function verifiedDocumentFixture(field: EvidenceField, documentId: string): GoverningDocumentVerification {
  return { field, verifiedAsOf: "2026-01-15", versionReference: "Registry filing 2016-11-28", evidenceKind: "document", documentId, recordedAtISO: FIXTURE_RECORDED_AT, verifiedByName: "Fixture reviewer" };
}

function heldElsewhereFixture(field: EvidenceField, kind: GoverningDocumentEvidenceEntry["kind"]): GoverningDocumentEvidenceEntry {
  return {
    field,
    kind,
    reference: kind === "external" ? "BC Registry Societies Online filing history" : "Records office binder, 100 Main St",
    custodian: "Secretary",
    recordedAtISO: FIXTURE_RECORDED_AT,
    recordedByName: "Fixture reviewer",
  };
}

const compliantSociety: ComplianceSociety = {
  isMemberFunded: false,
  privacyPolicyDocId: "doc_privacy",
  privacyProgramStatus: "Documented",
  privacyProgramReview: compliantPrivacyReview,
  memberDataAccessStatus: "Society-controlled",
  memberDataGapDocumented: true,
  constitutionDocId: "doc_constitution",
  bylawsDocId: "doc_bylaws",
  governingDocumentVerifications: [
    verifiedDocumentFixture("constitutionDocId", "doc_constitution"),
    verifiedDocumentFixture("bylawsDocId", "doc_bylaws"),
  ],
};

const compliantDirector: ComplianceDirector = {
  consentState: "verified",
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

/**
 * "Current constitution identified and required records accounted for?" (and
 * the same for bylaws). Satisfied by an uploaded copy or a recorded external
 * or physical location; a separate, lower-key note asks someone to verify the
 * identified copy is current. The text never says the society lacks the
 * document, only that Societyer doesn't have it identified. A BC society
 * always keeps both, so there is no "not applicable" path.
 */
function governingDocumentRule(args: {
  id: string;
  field: "constitutionDocId" | "bylawsDocId";
  label: string;
  phrase: string;
}): DashboardComplianceRule {
  const upload = { id: `upload-${args.phrase}`, label: `Upload ${args.phrase}`, intent: "navigate", to: "/app/society?tab=documents#governing-documents" };
  const heldElsewhere = { id: "record-held-elsewhere", label: "Held elsewhere", intent: "navigate", to: heldElsewhereHref(args.field) };
  const verify = { id: "verify-current", label: "Verify current", intent: "navigate", to: governingEvidenceHref("verify", args.field) };
  const assign = { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" };
  return {
    id: args.id,
    audience: "bc_society",
    jurisdiction: "BC",
    societyType: "society",
    effectiveDate: "2016-11-28",
    ruleText: `The current ${args.phrase} should be identified (an uploaded copy, an external reference or a physical records location) and verified as current.`,
    citation: "Societies Act records requirements",
    evidenceRequired: [
      `Uploaded ${args.phrase}, external system reference or physical records location`,
      "Currentness verification: date, reviewer, version or filing reference",
    ],
    remediationActions: [upload, heldElsewhere, verify, assign],
    passFail(context) {
      if (!context.society) return null;
      const currentness = governingDocumentCurrentness(context.society, args.field);
      if (currentness.state === "missing") {
        return {
          ...flag(this, {
            level: "warn",
            text: `Current ${args.phrase} not yet identified in Societyer. Upload a copy or record where the authoritative copy is held.`,
            citationId: "BC-SOC-RECORDS",
          }),
          remediationActions: [upload, heldElsewhere, assign],
        };
      }
      if (currentness.state === "unverified") {
        // Info, not warn: the authoritative copy is accounted for; whether it
        // is still the current version is a review note, not a records gap.
        return {
          ...flag(this, {
            level: "info",
            text: `${args.label} on record — currentness not verified.${currentness.staleVerification ? " The copy verified earlier has since been replaced." : ""}`,
            citationId: "BC-SOC-RECORDS",
          }),
          remediationActions: [verify, assign],
        };
      }
      return null;
    },
    fixtures: [
      {
        name: `flags missing ${args.phrase} evidence`,
        context: baseFixture({ society: { ...compliantSociety, [args.field]: undefined, governingDocumentVerifications: [] } }),
        expectedLevel: "warn",
      },
      {
        name: `accepts ${args.phrase} held in an external system (currentness still unverified)`,
        context: baseFixture({ society: { ...compliantSociety, [args.field]: undefined, governingDocumentEvidence: [heldElsewhereFixture(args.field, "external")], governingDocumentVerifications: [] } }),
        expectedLevel: "info",
      },
      {
        name: `passes ${args.phrase} kept at a physical records location once verified`,
        context: baseFixture({
          society: {
            ...compliantSociety,
            [args.field]: undefined,
            governingDocumentEvidence: [heldElsewhereFixture(args.field, "physical")],
            governingDocumentVerifications: [{ field: args.field, verifiedAsOf: "2026-01-15", evidenceKind: "physical", evidenceRecordedAtISO: FIXTURE_RECORDED_AT, recordedAtISO: FIXTURE_RECORDED_AT, verifiedByName: "Fixture reviewer" }],
          },
        }),
        expectedLevel: null,
      },
      {
        name: `notes uploaded but unverified ${args.phrase}`,
        context: baseFixture({ society: { ...compliantSociety, governingDocumentVerifications: [] } }),
        expectedLevel: "info",
      },
      {
        name: `notes ${args.phrase} replaced after verification`,
        context: baseFixture({ society: { ...compliantSociety, [args.field]: "doc_replacement" } }),
        expectedLevel: "info",
      },
    ],
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
      ruleText: "Each active director's consent basis (written consent, or presence at the meeting without refusing) should be recorded and its evidence reviewed.",
      citation: "Societies Act s.42 director consent requirements",
      evidenceRequired: ["Active director register", "Written consent or meeting-attendance/non-refusal evidence"],
      remediationActions: [
        { id: "open-directors", label: "Review consents", intent: "navigate", to: "/app/directors?intent=consent" },
        { id: "upload-evidence", label: "Upload evidence", intent: "navigate", to: "/app/documents?intent=new&category=Governance&title=Director%20consent" },
        { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        const text = unverifiedConsentSentence(context.activeDirectors.map((director) => director.consentState));
        return text ? flag(this, { level: "warn", text, citationId: "BC-SOC-DIRECTOR-CONSENT" }) : null;
      },
      fixtures: [
        {
          name: "flags active directors whose consent basis is not verified",
          context: baseFixture({
            activeDirectors: [
              compliantDirector,
              { ...compliantDirector, consentState: "awaiting_review" },
              { ...compliantDirector, consentState: "none" },
            ],
          }),
          expectedLevel: "warn",
        },
        {
          name: "a disputed, scheduled or legacy-flag consent is not verified",
          context: baseFixture({
            activeDirectors: [
              { ...compliantDirector, consentState: "disputed" },
              { ...compliantDirector, consentState: "scheduled" },
              { ...compliantDirector, consentState: "legacy_flag_only" },
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
      ruleText: "Privacy policies and practices should be reviewed, with who reviewed them, when, their version, where they are maintained and any unresolved findings recorded.",
      citation: "Personal Information Protection Act",
      evidenceRequired: ["Privacy review attestation (reviewer, date, policies and practices reviewed, version, location)", "Unresolved findings, if any"],
      remediationActions: [
        { id: "record-privacy-review", label: "Record review", intent: "navigate", to: PRIVACY_REVIEW_HREF },
        { id: "create-policy-template", label: "Create from template", intent: "createPipaPolicyDraft" },
        { id: "assign-review", label: "Assign review", intent: "createPrivacyReviewTask" },
      ],
      passFail(context) {
        if (!context.society) return null;
        const assessment = privacyProgramAssessment(context.society);
        const review = assessment.review;
        const by = review ? attestationLine("Reviewed", review.reviewedByName, review.reviewedOn) : "";
        switch (assessment.state) {
          case "documented":
            return null;
          case "findings":
            return flag(this, {
              level: "warn",
              text: `Privacy review has unresolved findings (${by}): ${shortText(review?.unresolvedFindings)}`,
              citationId: "PIPA-POLICY",
            });
          case "no-location":
            return flag(this, {
              level: "warn",
              text: `Privacy review recorded (${by}) without where the policy and practices are maintained.`,
              citationId: "PIPA-POLICY",
            });
          case "unattested":
            // Marked documented by hand (or inferred from a linked policy) with
            // no review on record: a note, not a gap the organization must fix.
            // The duty is still statutory (not dismissable); the fix is one
            // "Record review", so a policy template isn't offered here.
            return {
              ...flag(this, {
                level: "info",
                text: "Privacy program is marked documented, but no review attestation is recorded in Societyer.",
                citationId: "PIPA-POLICY",
              }),
              remediationActions: this.remediationActions.filter((action) => action.intent !== "createPipaPolicyDraft"),
            };
          default:
            return flag(this, {
              level: "warn",
              text: review
                ? `Privacy program is marked ${assessment.status} since the last review (${by}).`
                : "Privacy policy and practices have not been reviewed and recorded in Societyer.",
              citationId: "PIPA-POLICY",
            });
        }
      },
      fixtures: [
        {
          name: "flags undocumented privacy practices",
          context: baseFixture({
            society: { ...compliantSociety, privacyProgramStatus: "Needs review", privacyProgramReview: undefined },
          }),
          expectedLevel: "warn",
        },
        {
          name: "keeps the program outstanding while a review has unresolved findings",
          context: baseFixture({
            society: { ...compliantSociety, privacyProgramStatus: "Needs review", privacyProgramReview: { ...compliantPrivacyReview, unresolvedFindings: "Complaint process not published." } },
          }),
          expectedLevel: "warn",
        },
        {
          name: "notes a program marked documented without a review attestation",
          context: baseFixture({
            society: { ...compliantSociety, privacyProgramReview: undefined },
          }),
          expectedLevel: "info",
        },
        {
          name: "passes a review with a location and no unresolved findings",
          context: baseFixture({}),
          expectedLevel: null,
        },
      ],
    },
    {
      id: "PIPA-POLICY-EVIDENCE",
      audience: "bc_organization",
      jurisdiction: "BC",
      societyType: "society",
      effectiveDate: "2004-01-01",
      ruleText: "Societyer should know where the privacy policy is maintained: an uploaded copy, an external system reference or a physical records location.",
      citation: "Personal Information Protection Act",
      evidenceRequired: ["Uploaded privacy policy, external reference or physical records location"],
      remediationActions: [
        { id: "upload-policy", label: "Upload policy", intent: "navigate", to: "/app/privacy" },
        { id: "record-held-elsewhere", label: "Held elsewhere", intent: "navigate", to: heldElsewhereHref("privacyPolicyDocId") },
        { id: "create-policy-template", label: "Create from template", intent: "createPipaPolicyDraft" },
        { id: "assign-review", label: "Assign review", intent: "createPrivacyReviewTask" },
        { id: "link-board-minutes", label: "Link board approval minutes", intent: "navigate", to: "/app/policies" },
      ],
      passFail(context) {
        if (!context.society) return null;
        if (!hasIdentifiedEvidence(context.society, "privacyPolicyDocId")) {
          return flag(this, {
            level: "warn",
            text: "Societyer doesn't have the privacy policy's location identified. Upload a copy or record where it is maintained.",
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
        {
          name: "accepts a privacy policy held in an external system",
          context: baseFixture({
            society: { ...compliantSociety, privacyPolicyDocId: undefined, governingDocumentEvidence: [heldElsewhereFixture("privacyPolicyDocId", "external")] },
          }),
          expectedLevel: null,
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
    governingDocumentRule({
      id: "BC-SOC-CONSTITUTION-EVIDENCE",
      field: "constitutionDocId",
      label: "Constitution",
      phrase: "constitution",
    }),
    governingDocumentRule({
      id: "BC-SOC-BYLAWS-EVIDENCE",
      field: "bylawsDocId",
      label: "Bylaws",
      phrase: "bylaws",
    }),
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
        { id: "upload-bylaws", label: "Upload bylaws", intent: "navigate", to: "/app/society?tab=documents#governing-documents" },
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


/** Non-BC privacy laws: marked documented and no unresolved review findings. */
function privacyProgramSettled(society: (EvidenceFacts & { privacyProgramStatus?: string }) | null | undefined) {
  const state = privacyProgramAssessment(society).state;
  return state === "documented" || state === "unattested";
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
    out.push(make(`LEGAL-${profile.id}-DIRECTOR-CONSENT`, 'Director consent basis verified', profile.directors.consentSourceIds, audience, ctx => {
      if (ctx.activeDirectors.every(d => consentStateSatisfied(d.consentState))) return null;
      const text = unverifiedConsentSentence(ctx.activeDirectors.map(d => d.consentState));
      return { level: 'warn', text: `${text} ${profile.directors.consent}` };
    }));
    if (profile.directors.residency === 'canadian_25_percent') out.push(make(`LEGAL-${profile.id}-DIRECTORS-RESIDENCY`, 'Resident Canadian director requirement', profile.directors.sourceIds, audience, ctx => {
      const required = requiredResidentCanadianDirectors(ctx.activeDirectors.length);
      const confirmed = ctx.activeDirectors.filter(d => d.residentCanadianStatus === 'yes').length;
      const unknown = ctx.activeDirectors.filter(d => !d.residentCanadianStatus || d.residentCanadianStatus === 'unknown').length;
      return confirmed < required ? { level: unknown ? 'warn' : 'err', text: `${confirmed} confirmed resident Canadian director${confirmed === 1 ? '' : 's'}; at least ${required} required for the recorded board. ${unknown ? `${unknown} residency assessment${unknown === 1 ? '' : 's'} outstanding. ` : ''}Review stricter regulated-sector exceptions.` } : null;
    }));
    out.push(make(`LEGAL-${profile.id}-CLASSIFICATION`, 'Public/private classification', profile.directors.sourceIds, audience, ctx => ctx.society?.distributing === undefined ? { level: 'warn', text: 'Confirm the applicable public, distributing or offering classification; director minima and governance exceptions depend on it.' } : null, '/app/society'));
    out.push(make(`LEGAL-${profile.id}-GOVERNING-DOCUMENTS`, 'Governing-document evidence', profile.records[0]?.sourceIds ?? [], audience, ctx => !hasIdentifiedEvidence(ctx.society, 'bylawsDocId') && !hasIdentifiedEvidence(ctx.society, 'constitutionDocId') ? { level: 'warn', text: `Identify the current ${profile.id === 'bc_company' ? 'articles and notice of articles' : 'articles and by-laws'} (upload a copy or record where they are held) and review the entity-specific minute-book checklist.` } : null, '/app/minute-book'));
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
      out.push(make(`PRIVACY-${lawId}-POLICY`, 'Privacy practices and policy evidence', sources, audience, ctx => !hasIdentifiedEvidence(ctx.society, 'privacyPolicyDocId') || !privacyProgramSettled(ctx.society) ? { level: 'warn', text: `Review the policy and practices for ${law.label} and record where they are maintained. A document upload alone does not establish compliance.` } : null, '/app/privacy'));
    }
  }
  return out;
}
