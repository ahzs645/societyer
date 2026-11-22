/**
 * Which compliance rule packs apply to the workspace and the facts they still
 * need. Shown on Compliance settings; Compliance obligations keeps only a
 * one-line notice when facts are missing (complianceMissingFacts).
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Badge } from "@/components/ui";
import { calendarDateKey } from "../../lib/calendarDates";
import { formatDate } from "../../lib/format";
import { loadComplianceRulePacks } from "../../lib/compliance/registry";
import { complianceFactsForOrganization, filterApplicableCompliancePacks } from "../../lib/compliance";
import type { ComplianceFacts } from "../../lib/compliance";
import { ORG_HUB_OPTION_SETS } from "../../lib/orgHubOptions";
import { useOrganizationWorkspace } from "../../hooks/useOrganizationWorkspace";
import { deriveAgmFacts } from "../../../shared/agmEvidence";
import { jurisdictionDisplayCopy, jurisdictionModuleContract } from "../../../shared/jurisdictionWorkspace";
import { homeJurisdictionCode, organizationEntityType, organizationLabel, type Organization } from "../../../shared/organizationDomain";

/** The facts the rule packs need that the workspace has not recorded, as phrases for "Missing facts: …". */
export function complianceMissingFacts(organization: Organization, factsList: readonly ComplianceFacts[]): string[] {
  const facts = factsList[0] ?? null;
  return [
    ...requiredFactLabels(facts),
    ...(!facts?.formationInferredFromRecords && (["preparing", "submitted", "unverified_existing"].includes(organization.formationStatus ?? "") || organization.organizationStatus === "pre_incorporation") ? ["verified certificate evidence before legal duties activate"] : []),
    ...factsList.filter(item => item.contextKind === "extra_provincial").flatMap(item => item.jurisdictionCode === "CA-ON-OBCA" && !item.commencedBusinessDate
      ? [`Ontario business commencement date (${item.contextLabel ?? "registration"})`]
      : item.jurisdictionCode === "CA-BC" && !item.registrationDate ? [`BC registration date (${item.contextLabel ?? "registration"})`] : []),
    ...(facts?.legalSubtype && ["unlimited_liability_company", "community_contribution_company", "benefit_company", "other"].includes(facts.legalSubtype) ? ["reviewed subtype rule pack before automated deadlines"] : []),
  ];
}

function requiredFactLabels(facts: ComplianceFacts | null) {
  if (!facts) return [];
  const missing: string[] = [];
  if (!facts.incorporationDate) missing.push("incorporation date");
  if (!facts.anniversaryDate) missing.push("anniversary date");
  if (!facts.fiscalYearEnd) missing.push("fiscal year end");
  if (facts.entityType === "society" && !facts.annualMeetingDate) missing.push("the date of the last AGM held (record it as a held AGM meeting or on the society profile) to compute the annual report deadline");
  if (facts.entityType !== "society" && !facts.annualReferenceDate) missing.push("last annual meeting/annual reference date for subsequent meetings");
  return missing;
}

/** Compliance settings → Rule packs: the matched packs, the AGM evidence they use and any missing facts. */
export function ComplianceRulePacksSection() {
  const { organization, society } = useOrganizationWorkspace();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const detail = useQuery(api.organizationDetails.overview, society ? { societyId: society._id } : "skip") as any | undefined;
  const factsList = useMemo(
    () => (organization ? complianceFactsForOrganization(organization, { registrations: detail?.registrations ?? [], meetings: meetings ?? [] }) : []),
    [detail?.registrations, meetings, organization],
  );
  const packs = useMemo(() => factsList.flatMap((item) => filterApplicableCompliancePacks(item)), [factsList]);
  const packTitles = useMemo(() => new Map(loadComplianceRulePacks().map((pack) => [pack.packId, pack.title])), []);
  if (!organization) return null;

  const facts = factsList[0] ?? null;
  const agmFacts = deriveAgmFacts(organization, meetings ?? [], facts?.asOfDate ?? calendarDateKey(new Date()));
  const jurisdictionCode = homeJurisdictionCode(organization);
  const jurisdictionCopy = jurisdictionDisplayCopy(organization);
  const jurisdictionModule = jurisdictionModuleContract(organization);
  const missingFacts = complianceMissingFacts(organization, factsList);

  return (
    <section className="card settings-section">
      <div className="settings-section__head">
        <h2 className="settings-section__title">Rule packs</h2>
        <Badge tone={packs.length ? "success" : "warn"}>{packs.length ? "Rule pack matched" : "No executable pack"}</Badge>
      </div>
      <p className="settings-section__hint">
        {organizationLabel(organization)} · {jurisdictionModule.registryPortalLabel} · {entityTypeLabel(organizationEntityType(organization))}.{" "}
        Compliance obligations are computed from these packs.
      </p>
      {facts?.formationInferredFromRecords ? (
        <p className="settings-section__hint" role="status">
          {organization.formationStatus === "unverified_existing"
            ? <>The profile records this {jurisdictionCopy.entityLabel} as an existing organization whose incorporation evidence is not verified yet. {agmFacts.agmDates.length} held AGM</>
            : <>The profile says this {jurisdictionCopy.entityLabel} is still being formed, but {agmFacts.agmDates.length} held AGM</>}
          {agmFacts.agmDates.length === 1 ? " is" : "s are"} on record (latest {formatDate(agmFacts.annualMeetingDate ?? "")}).
          Obligations are computed provisionally from those meeting records.{" "}
          <Link to="/app/society">{organization.formationStatus === "unverified_existing" ? "Verify the incorporation certificate and date" : "Confirm the formation status and incorporation date"}</Link> to remove this caveat.
        </p>
      ) : null}
      {agmFacts.annualMeetingDate ? (
        <p className="settings-section__hint">
          Latest AGM on record: <strong>{formatDate(agmFacts.annualMeetingDate)}</strong>
          {agmFacts.source === "meetings" ? " (from meeting records)" : " (from the society profile)"}.
        </p>
      ) : null}
      <p className="settings-section__hint">
        {missingFacts.length
          ? <>Missing facts: {missingFacts.join("; ")}. Add them to compute more obligations.</>
          : "The date inputs for this schedule are recorded. The legal calendar boundary still requires review."}
      </p>
      {jurisdictionModule.compliancePackIds.length ? (
        <details className="disclosure obligations-packs">
          <summary>Rule packs ({jurisdictionModule.compliancePackIds.length})</summary>
          <ul>
            {jurisdictionModule.compliancePackIds.map((packId) => (
              <li key={packId} title={`${jurisdictionCode} · ${packId}`}>{packTitles.get(packId) ?? packId}</li>
            ))}
          </ul>
        </details>
      ) : <Badge tone="neutral">No configured pack</Badge>}
    </section>
  );
}

function entityTypeLabel(value: string) {
  return ORG_HUB_OPTION_SETS.entityTypes.find((option) => option.value === value)?.label ?? capitalize(value);
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
