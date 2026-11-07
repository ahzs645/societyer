import { incorporationActForValue } from "../incorporationActs";
import { legalGovernanceProfile } from "../legalGovernanceProfiles";
import { isPreparingIncorporation } from "../organizationDomain";
import { resolvePathway } from "../pathways/registry";
import { normalizeOrganizationIdentity } from "./normalize";
import type { GovernanceModel, LegalForm, OrganizationContext, OrganizationSource, WorkflowReason } from "./types";

const GOVERNANCE_MODELS: Record<LegalForm, GovernanceModel> = {
  business_corporation: "shares", society: "members", nonprofit_corporation: "members", cooperative: "cooperative",
  sole_proprietorship: "proprietor", partnership: "partners", unincorporated_association: "members", other: "undetermined", unknown: "undetermined",
};
const LEGACY_ENTITY_TYPES: Partial<Record<LegalForm, string>> = {
  business_corporation: "corporation__business_", society: "society", nonprofit_corporation: "corporation__nfp_", cooperative: "cooperative",
};

/** Adapt recorded facts once, keeping legal-form coverage separate from registrations and tax treatment. */
export function resolveOrganizationContext(organization?: OrganizationSource | null): OrganizationContext {
  const source = organization ?? {};
  const identity = normalizeOrganizationIdentity(source);
  const act = incorporationActForValue(identity.actValue, identity.jurisdictionCode);
  const declared = {
    entityType: LEGACY_ENTITY_TYPES[identity.legalForm] ?? identity.legalForm,
    jurisdictionCode: act?.jurisdictionCode ?? identity.jurisdictionCode,
    actFormedUnder: identity.actValue,
    legalSubtype: source.legalSubtype,
    isMemberFunded: source.isMemberFunded,
    distributing: source.distributing,
    solicitingPublicBenefit: source.solicitingPublicBenefit,
    isCharity: source.isCharity,
    charityStatus: source.charityStatus,
  };
  const explicitActIdentity = identity.status === "recorded" && !!identity.actValue;
  const governanceModel = identity.status === "conflict" ? "undetermined" : GOVERNANCE_MODELS[identity.legalForm];
  const profile = explicitActIdentity ? legalGovernanceProfile(declared) : undefined;
  const expectedKind = identity.legalForm === "business_corporation" ? "corporation" : identity.legalForm === "society" ? "society" : "organization";
  const governanceProfile = profile?.kind === expectedKind ? profile : undefined;
  const preparation = explicitActIdentity
    ? resolvePathway(declared)
    : { allowed: false, message: identity.issues[0]?.message ?? "Confirm the legal form, formation jurisdiction and governing Act before selecting a preparation route." };
  const classificationIssues: WorkflowReason[] = [];
  const memberFunded = source.isMemberFunded === true || source.legalSubtype === "member_funded_society";
  if (memberFunded) {
    classificationIssues.push({
      code: source.isCharity || source.charityStatus === "registered" ? "MEMBER_FUNDED_CHARITY_CONFLICT" : "MEMBER_FUNDED_EVIDENCE_REVIEW",
      message: source.isCharity || source.charityStatus === "registered"
        ? "The member-funded claim conflicts with the recorded charity status. Review the classification and governing documents."
        : "Member-funded status is a recorded claim. Review eligibility and the constitution before relying on its exceptions.",
      field: "isMemberFunded", nextAction: "/app/society",
    });
  }
  if (source.distributing || source.solicitingPublicBenefit) classificationIssues.push({
    code: "SPECIAL_CLASSIFICATION_REVIEW", message: "The recorded public, distributing or public-benefit flag needs an Act-specific review; it is not a completed classification assessment.",
    field: source.distributing ? "distributing" : "solicitingPublicBenefit", nextAction: "/app/society",
  });
  return {
    identity, governanceModel, governanceProfile, preparation, classificationIssues,
    legacyClaims: { memberFunded, isCharity: source.isCharity, charityStatus: source.charityStatus },
    preparing: isPreparingIncorporation(source),
  };
}

/** Legal-form gate only. Existing permission, evidence and statutory action checks still run in the handler. */
export function assertBusinessCorporationAction(organization?: OrganizationSource | null): void {
  const identity = normalizeOrganizationIdentity(organization);
  if (identity.legalForm !== "business_corporation" || identity.status === "conflict") {
    throw new Error("This share or dividend action requires a recorded business-corporation identity without conflicting legal fields. Review the organization profile; other ownership models need their own supported workflow.");
  }
}

/** Conflicts that affect receipting independently of dated registration and gift checks. */
export function officialReceiptOrganizationIssues(context: OrganizationContext): WorkflowReason[] {
  if (context.identity.status === "conflict") return context.identity.issues;
  if (context.legacyClaims.memberFunded) return [{
    code: "MEMBER_FUNDED_CHARITY_CONFLICT",
    message: "Review the member-funded claim against the charity registration and governing documents before preparing an official receipt.",
    field: "isMemberFunded", nextAction: "/app/society",
  }];
  return [];
}

export function assertOfficialReceiptOrganization(organization?: OrganizationSource | null): void {
  const issues = officialReceiptOrganizationIssues(resolveOrganizationContext(organization));
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(" "));
}
