import { resolveOrganizationContext } from "./organization/resolveContext";
import { organizationWorkflowAssessments, type WorkflowAssessmentOptions } from "./organization/assessWorkflow";
import type { OrganizationSource } from "./organization/types";

export type CapabilityOrganization = OrganizationSource;
export type OrganizationCapabilityLink = { key: string; title: string; detail: string; to: string };

/** Display projection. Actor permissions and record-specific action checks stay in their handlers. */
export function organizationCapabilities(organization: CapabilityOrganization, options: WorkflowAssessmentOptions = {}) {
  const context = resolveOrganizationContext(organization);
  const { identity, governanceProfile: profile, preparation: route } = context;
  const workflows = organizationWorkflowAssessments(context, options);
  const governance = workflows.find(row => row.action === "governance.review")!;
  const preparation = workflows.find(row => row.action === "incorporation.prepare")!;
  const memberRecords = workflows.find(row => row.action === "members.record")!;
  const shareRecords = workflows.find(row => row.action === "shares.record")!;
  const kind = identity.legalForm === "society" ? "society" as const
    : identity.legalForm === "business_corporation" ? "corporation" as const : "organization" as const;
  const governanceSupported = Boolean(profile);
  const preparationSupported = preparation.coverage === "guided_preparation";
  const reviewRequired = governance.readiness !== "ready" || preparation.readiness !== "ready";

  const features: OrganizationCapabilityLink[] = [
    { key: "people", title: "People and roles", detail: "Record directors, officers and their appointment evidence. App access is separate from legal participation.", to: "/app/role-holders" },
    ...(memberRecords.applicability === "applies" ? [{ key: "members", title: "Membership and member decisions", detail: memberRecords.reasons[0].message, to: "/app/members" }]
      : shareRecords.applicability === "applies" ? [{ key: "shares", title: "Share ownership and shareholder decisions", detail: shareRecords.reasons[0].message, to: "/app/rights-ledger" }]
        : [{ key: "rights", title: "Rights and participation", detail: "Review the governance model and preserve its existing rights records. No company share model is inferred.", to: "/app/rights-ledger" }]),
    { key: "documents", title: "Governing documents and evidence", detail: "Retain the constitution, bylaws or articles that apply, with signed decisions and filing receipts.", to: "/app/documents" },
    { key: "annual", title: "Meetings and annual obligations", detail: governanceSupported
      ? `${profile!.annualMeeting.label}; ${profile!.annualReturn.label}. Check the applicable conditions and recorded evidence.`
      : "Record meetings and obligations after reviewing the rules for this entity and jurisdiction.", to: "/app/annual-cycle" },
  ];

  const nextSteps: OrganizationCapabilityLink[] = [];
  if (identity.status !== "recorded") {
    nextSteps.push({ key: "identity", title: "Confirm the entity, home jurisdiction and governing Act", detail: identity.issues.map(issue => issue.message).join(" "), to: "/app/society" });
  } else if (!governanceSupported) {
    nextSteps.push({ key: "coverage", title: "Review statutory requirements for this legal form", detail: governance.reasons.map(issue => issue.message).join(" "), to: "/app/society" });
  }
  if (identity.status === "recorded" && preparation.readiness !== "ready") {
    nextSteps.push({ key: "review", title: "Review the preparation route and special status", detail: preparation.reasons.map(issue => issue.message).join(" "), to: "/app/society" });
  } else if (preparationSupported && context.preparing) {
    nextSteps.push({ key: "prepare", title: "Prepare and review the governing documents", detail: "Follow the setup steps, file through the official registry, then retain the accepted certificate and supporting records.", to: "/app/document-catalog" });
  } else if (governanceSupported) {
    nextSteps.push({ key: "annual", title: "Review the annual cycle against your records", detail: "Confirm the next meeting and filing obligations, with their supporting documents and receipts.", to: "/app/annual-cycle" });
  }
  nextSteps.push({ key: "tax", title: "Record tax registrations and assess what you sell", detail: "Incorporation, nonprofit status, charity registration and sales-tax treatment are separate decisions. Record the applicable tax accounts, then assess each item and transaction.", to: "/app/society" });

  return {
    kind,
    entityLabel: identity.legalFormLabel,
    jurisdictionCode: identity.jurisdictionCode,
    jurisdictionLabel: identity.jurisdictionLabel,
    actLabel: identity.actLabel,
    identity,
    governanceModel: context.governanceModel,
    reviewRequired,
    governance: {
      supported: governanceSupported,
      profileId: profile?.id,
      profileName: profile?.name,
      reviewedOn: profile?.reviewedOn,
      message: governance.reasons.map(issue => issue.message).join(" "),
      records: profile?.records ?? [],
      caveats: profile?.caveats ?? [],
    },
    preparation: {
      supported: preparationSupported,
      pathwayKey: route.pathway?.key,
      version: route.pathway?.version,
      message: preparation.reasons.map(issue => issue.message).join(" "),
      reviewedDrafts: identity.status === "recorded" && !context.classificationIssues.some(issue => issue.code === "SPECIAL_CLASSIFICATION_REVIEW")
        ? route.pathway?.reviewedPreparationPacketKeys ?? [] : [],
    },
    workflows,
    features,
    nextSteps,
  };
}
