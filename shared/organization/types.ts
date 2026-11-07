import type { LegalEntityLike } from "../organizationDomain";
import type { LegalGovernanceProfile } from "../legalGovernanceTypes";
import type { PathwayDefinition } from "../pathways/registry";

export type LegalForm =
  | "business_corporation" | "society" | "nonprofit_corporation" | "cooperative"
  | "sole_proprietorship" | "partnership" | "unincorporated_association" | "other" | "unknown";

export type GovernanceModel = "members" | "shares" | "cooperative" | "partners" | "proprietor" | "undetermined";
export type Applicability = "applies" | "not_applicable" | "undetermined";
export type RuleCoverage = "records_only" | "guided_preparation" | "checked_action" | "unavailable";
export type Readiness = "ready" | "needs_information" | "needs_review" | "blocked";

export type OrganizationSource = LegalEntityLike & {
  legalSubtype?: string | null;
  isMemberFunded?: boolean;
  distributing?: boolean;
  solicitingPublicBenefit?: boolean;
  isCharity?: boolean;
  charityStatus?: string;
};

export type WorkflowReason = {
  code: string;
  message: string;
  field?: string;
  nextAction?: string;
};

export type OrganizationContext = {
  identity: {
    /** Recorded means internally consistent declarations, not verified formation evidence. */
    status: "recorded" | "incomplete" | "conflict";
    legalForm: LegalForm;
    legalFormLabel: string;
    countryCode?: string;
    jurisdictionCode: string;
    jurisdictionLabel: string;
    actValue?: string;
    actLabel: string;
    issues: WorkflowReason[];
  };
  governanceModel: GovernanceModel;
  governanceProfile?: LegalGovernanceProfile;
  preparation: { allowed: boolean; message: string; pathway?: PathwayDefinition };
  classificationIssues: WorkflowReason[];
  /** The existing fields are adapted, never rewritten or promoted to evidence. */
  legacyClaims: {
    memberFunded?: boolean;
    charityStatus?: string;
    isCharity?: boolean;
  };
  preparing: boolean;
};

export type OrganizationWorkflow =
  | "members.record"
  | "shares.record"
  | "governance.review"
  | "incorporation.prepare"
  | "donation.acknowledge"
  | "official_receipt.prepare";

export type WorkflowAssessment = {
  action: OrganizationWorkflow;
  applicability: Applicability;
  coverage: RuleCoverage;
  readiness: Readiness;
  reasons: WorkflowReason[];
  evidenceIds: string[];
  ruleReferences: Array<{ id: string; version?: string; reviewedOn?: string }>;
};

/** Authorization belongs to the current actor, never to the organization profile. */
export type WorkflowAuthorization = { allowed: boolean; requiredPermission: string };
