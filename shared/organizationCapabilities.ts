import { incorporationActForValue, incorporationJurisdictionForCode, entityKindForType } from "./incorporationActs";
import { hasDeclaredJurisdiction, hasRecordedEntityType, legalGovernanceProfile, type GovernanceOrganization } from "./legalGovernanceProfiles";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isPreparingIncorporation, organizationEntityType, organizationKind } from "./organizationDomain";
import { resolvePathway, type PathwayEntity } from "./pathways/registry";

export type CapabilityOrganization = GovernanceOrganization & PathwayEntity;
export type OrganizationCapabilityLink = { key: string; title: string; detail: string; to: string };

/**
 * A display projection, not an authorization or compliance decision. Core legal
 * rules and preparation routes have separate registries and coverage. Reuse both
 * rather than treating the Act catalogue's setup availability as legal coverage.
 */
export function organizationCapabilities(organization: CapabilityOrganization) {
  const jurisdictionCode = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  const actValue = organization.actFormedUnder?.trim() || undefined;
  const act = incorporationActForValue(actValue, jurisdictionCode);
  const profile = legalGovernanceProfile(organization);
  const route = resolvePathway(organization);
  const kind = organizationKind(organization);
  const entityKind = entityKindForType(organizationEntityType(organization));
  const explicitIdentity = hasRecordedEntityType(organization) && hasDeclaredJurisdiction(organization) && Boolean(actValue);
  // Existing legacy rule fallbacks stay in their resolver. They must not become
  // a claim that an unconfirmed identity has reviewed coverage in this overview.
  const specialistReview = Boolean(organization.distributing || organization.solicitingPublicBenefit);
  const governanceSupported = explicitIdentity && Boolean(profile) && profile!.kind === kind;
  const preparationSupported = explicitIdentity && route.allowed && !specialistReview;
  const reviewRequired = !governanceSupported || !preparationSupported || specialistReview;
  const entityLabel = entityKind === "not_for_profit_corporation" ? "Nonprofit corporation"
    : entityKind === "cooperative" ? "Cooperative"
      : kind === "society" ? "Society (nonprofit)"
        : kind === "corporation" ? "Business corporation" : "Organization";

  const features: OrganizationCapabilityLink[] = [
    { key: "people", title: "People and roles", detail: "Record directors, officers and their appointment evidence.", to: "/app/role-holders" },
    kind === "society"
      ? { key: "members", title: "Membership and member decisions", detail: "Manage member records, membership classes and participation.", to: "/app/members" }
      : kind === "corporation"
        ? { key: "shares", title: "Share ownership and shareholder decisions", detail: "Record share classes, holdings and ownership changes.", to: "/app/rights-ledger" }
        : { key: "rights", title: "Rights and participation", detail: "Record the organization's rights structure after checking its governing documents.", to: "/app/rights-ledger" },
    { key: "documents", title: "Governing documents and evidence", detail: "Retain the constitution, bylaws or articles that apply, with signed decisions and filing receipts.", to: "/app/documents" },
    { key: "annual", title: "Meetings and annual obligations", detail: governanceSupported
      ? `${profile!.annualMeeting.label}; ${profile!.annualReturn.label}. Check the applicable conditions and recorded evidence.`
      : "Record meetings and obligations after reviewing the rules for this entity and jurisdiction.", to: "/app/annual-cycle" },
  ];

  const nextSteps: OrganizationCapabilityLink[] = [];
  if (!explicitIdentity || !governanceSupported) {
    nextSteps.push({ key: "identity", title: "Confirm the entity, home jurisdiction and governing Act", detail: "Check the incorporation or formation documents. A new country or Act needs its own reviewed rules before legal guidance can apply.", to: "/app/society" });
  }
  if (explicitIdentity && (!preparationSupported || specialistReview)) {
    nextSteps.push({ key: "review", title: "Review the preparation route and special status", detail: specialistReview
      ? "Public, distributing or public-benefit status needs an additional review beyond the private or ordinary core profile."
        : route.message, to: "/app/society" });
  } else if (preparationSupported && isPreparingIncorporation(organization)) {
    nextSteps.push({ key: "prepare", title: "Prepare and review the governing documents", detail: "Follow the setup steps, file through the official registry, then retain the accepted certificate and supporting records.", to: "/app/document-catalog" });
  } else if (governanceSupported) {
    nextSteps.push({ key: "annual", title: "Review the annual cycle against your records", detail: "Confirm the next meeting and filing obligations, with their supporting documents and receipts.", to: "/app/annual-cycle" });
  }
  nextSteps.push({ key: "tax", title: "Record tax registrations and assess what you sell", detail: "Incorporation, nonprofit status, charity registration and sales-tax treatment are separate decisions. Record the applicable tax accounts, then assess each item and transaction.", to: "/app/society" });

  return {
    kind,
    entityLabel,
    jurisdictionCode,
    jurisdictionLabel: incorporationJurisdictionForCode(jurisdictionCode)?.name ?? (jurisdictionCode === "unknown" ? "Not recorded" : jurisdictionCode),
    actLabel: act?.officialName ?? actValue ?? "Not recorded",
    reviewRequired,
    governance: {
      supported: governanceSupported,
      profileId: profile?.id,
      profileName: profile?.name,
      reviewedOn: profile?.reviewedOn,
      message: !explicitIdentity ? "Confirm the recorded legal identity before relying on a core governance profile."
        : governanceSupported ? "Core director, meeting, resolution, record and annual-obligation guidance is available. Entity facts and special statuses can add requirements."
          : "No reviewed core governance profile matches this legal identity. General records remain available; arrange an entity-specific review.",
      records: governanceSupported ? profile!.records : [],
      caveats: governanceSupported ? profile!.caveats : [],
    },
    preparation: {
      supported: preparationSupported,
      pathwayKey: route.pathway?.key,
      version: route.pathway?.version,
      message: !explicitIdentity ? "Confirm the entity, jurisdiction and Act before choosing a preparation route."
        : specialistReview ? "Public, distributing or public-benefit status needs a reviewed specialist preparation route." : route.message,
      reviewedDrafts: explicitIdentity && !specialistReview ? route.pathway?.reviewedPreparationPacketKeys ?? [] : [],
    },
    features,
    nextSteps,
  };
}
