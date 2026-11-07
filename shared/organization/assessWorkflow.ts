import { assessCharityRegistration, type CharityRegistrationRevision, type CharityRegistrationProjection } from "../receipting/registration";
import { officialReceiptOrganizationIssues } from "./resolveContext";
import type { OrganizationContext, OrganizationWorkflow, WorkflowAssessment, WorkflowReason } from "./types";

export type WorkflowAssessmentOptions = {
  charityRegistrations?: readonly (CharityRegistrationRevision | CharityRegistrationProjection)[];
  /** Required for date-sensitive registration assessments; no machine-clock default. */
  onDate?: string;
};

function assessment(action: OrganizationWorkflow, values: Omit<WorkflowAssessment, "action" | "evidenceIds" | "ruleReferences"> & Partial<Pick<WorkflowAssessment, "evidenceIds" | "ruleReferences">>): WorkflowAssessment {
  return { action, evidenceIds: [], ruleReferences: [], ...values };
}
const reason = (code: string, message: string, nextAction?: string): WorkflowReason => ({ code, message, ...(nextAction ? { nextAction } : {}) });

/**
 * Organization-side action assessment. It never grants a user permission or
 * certifies a transaction, signed instrument, filing or annual cycle complete.
 * Action handlers reload facts and apply their existing record-specific checks.
 */
export function assessOrganizationWorkflow(context: OrganizationContext, action: OrganizationWorkflow, options: WorkflowAssessmentOptions = {}): WorkflowAssessment {
  const { identity, governanceModel, governanceProfile, preparation } = context;
  const identityProblem = identity.status === "conflict" || identity.legalForm === "unknown";

  if (action === "donation.acknowledge") return assessment(action, {
    applicability: "applies", coverage: "checked_action", readiness: "ready",
    reasons: [reason("ACKNOWLEDGEMENT_AVAILABLE", "Record a contribution and prepare an acknowledgement. It makes no official donation tax-receipt claim.", "/app/receipts")],
  });

  if (action === "official_receipt.prepare") {
    if (!options.onDate) return assessment(action, {
      applicability: "undetermined", coverage: "checked_action", readiness: "needs_information",
      reasons: [reason("ASSESSMENT_DATE_REQUIRED", "Choose the receipt preparation date before checking registration evidence.", "/app/receipts")],
    });
    const registration = assessCharityRegistration(options.charityRegistrations ?? [], { onDate: options.onDate });
    const evidenceIds = registration.revision && "evidenceDocumentIds" in registration.revision ? registration.revision.evidenceDocumentIds : [];
    if (registration.readiness !== "ready") return assessment(action, {
      applicability: "undetermined", coverage: "checked_action", readiness: registration.readiness,
      reasons: registration.reasons, evidenceIds,
    });
    const organizationIssues = officialReceiptOrganizationIssues(context);
    if (organizationIssues.length) return assessment(action, {
      applicability: "undetermined", coverage: "checked_action", readiness: "needs_review", evidenceIds,
      reasons: organizationIssues,
    });
    return assessment(action, {
      applicability: "applies", coverage: "checked_action", readiness: "needs_information", evidenceIds,
      reasons: [reason("GIFT_REVIEW_REQUIRED", "Registration evidence is available. Review this gift, applicable dates, donor details and signature before completing an official receipt.", "/app/receipts")],
    });
  }

  if (action === "members.record" || action === "shares.record") {
    if (identityProblem) return assessment(action, {
      applicability: "undetermined", coverage: "records_only", readiness: identity.status === "conflict" ? "needs_review" : "needs_information",
      reasons: identity.issues.length ? identity.issues : [reason("LEGAL_FORM_REQUIRED", "Confirm the legal form before selecting this register.", "/app/society")],
    });
    if (action === "shares.record" && governanceModel === "cooperative") return assessment(action, {
      applicability: "undetermined", coverage: "unavailable", readiness: "needs_review",
      reasons: [reason("COOPERATIVE_OWNERSHIP_REVIEW", "A cooperative may have its own membership and share structure. This business-company share workflow does not establish the applicable cooperative rules.", "/app/society")],
    });
    const applies = action === "members.record" ? governanceModel === "members" || governanceModel === "cooperative" : governanceModel === "shares";
    if (!applies) return assessment(action, {
      applicability: governanceModel === "undetermined" ? "undetermined" : "not_applicable", coverage: "unavailable", readiness: governanceModel === "undetermined" ? "needs_review" : "blocked",
      reasons: [reason("REGISTER_MODEL_MISMATCH", action === "members.record" ? "This recorded ownership model does not use this legal member register." : "This recorded governance model does not use the business-company share register.", "/app/society")],
    });
    return assessment(action, {
      applicability: "applies", coverage: "records_only", readiness: "ready",
      reasons: [reason("RECORDS_AVAILABLE", action === "members.record"
        ? "Record legal members and their rights. Billing, donor relationships and app access remain separate; statutory guidance depends on the supported Act."
        : "Record share classes and ownership. Issuances and other changes keep their own permission, evidence and statutory checks.",
      action === "members.record" ? "/app/members" : "/app/rights-ledger")],
    });
  }

  if (identity.status !== "recorded") return assessment(action, {
    applicability: "undetermined", coverage: "unavailable", readiness: identity.status === "conflict" ? "needs_review" : "needs_information",
    reasons: identity.issues,
  });

  if (action === "governance.review") {
    if (!governanceProfile) return assessment(action, {
      applicability: "applies", coverage: "records_only", readiness: "needs_review",
      reasons: [reason("GOVERNANCE_PROFILE_UNAVAILABLE", "General records are available. No reviewed governance profile matches this legal identity; review statutory requirements separately.", "/app/society")],
    });
    return assessment(action, {
      applicability: "applies", coverage: "guided_preparation", readiness: context.classificationIssues.length ? "needs_review" : "ready",
      reasons: context.classificationIssues.length ? context.classificationIssues : [reason("GOVERNANCE_GUIDANCE_AVAILABLE", "The core profile is available for review. Each meeting, decision and annual obligation still needs its own facts and evidence.", "/app/annual-cycle")],
      ruleReferences: [{ id: governanceProfile.id, reviewedOn: governanceProfile.reviewedOn }],
    });
  }

  if (["sole_proprietorship", "partnership", "unincorporated_association"].includes(identity.legalForm)) return assessment(action, {
    applicability: "not_applicable", coverage: "unavailable", readiness: "blocked",
    reasons: [reason("INCORPORATION_NOT_CURRENT_FORM", "This operation is recorded as unincorporated. A new incorporation is a separate formation workflow.", "/app/society")],
  });
  const specialist = context.classificationIssues.some(issue => issue.code === "SPECIAL_CLASSIFICATION_REVIEW");
  if (!preparation.allowed || specialist) return assessment(action, {
    applicability: "applies", coverage: "unavailable", readiness: "needs_review",
    reasons: specialist ? context.classificationIssues : [reason("PREPARATION_UNAVAILABLE", preparation.message, "/app/society")],
    ruleReferences: preparation.pathway ? [{ id: preparation.pathway.key, version: preparation.pathway.version }] : [],
  });
  return assessment(action, {
    applicability: "applies", coverage: "guided_preparation", readiness: context.classificationIssues.length ? "needs_review" : "ready",
    reasons: context.classificationIssues.length ? context.classificationIssues : [reason("PREPARATION_GUIDANCE_AVAILABLE", preparation.message, "/app/organization-setup")],
    ruleReferences: preparation.pathway ? [{ id: preparation.pathway.key, version: preparation.pathway.version }] : [],
  });
}

export function organizationWorkflowAssessments(context: OrganizationContext, options: WorkflowAssessmentOptions = {}): WorkflowAssessment[] {
  return (["members.record", "shares.record", "governance.review", "incorporation.prepare", "donation.acknowledge", "official_receipt.prepare"] as const)
    .map(action => assessOrganizationWorkflow(context, action, options));
}
