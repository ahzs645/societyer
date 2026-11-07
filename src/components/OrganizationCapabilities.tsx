import { Link } from "react-router-dom";
import { organizationCapabilities, type CapabilityOrganization } from "../../shared/organizationCapabilities";
import type { WorkflowAssessmentOptions } from "../../shared/organization/assessWorkflow";
import type { OrganizationWorkflow } from "../../shared/organization/types";
import { todayDateOnly } from "../../shared/dateOnly";
import { usePermissions } from "../hooks/usePermissions";
import { Badge } from "./ui";
import "./organizationCapabilities.css";

const WORKFLOWS: Record<OrganizationWorkflow, { label: string; permission: string; to: string }> = {
  "members.record": { label: "Legal member records", permission: "members:write", to: "/app/members" },
  "shares.record": { label: "Company share records", permission: "documents:write", to: "/app/rights-ledger" },
  "governance.review": { label: "Core governance guidance", permission: "documents:read", to: "/app/annual-cycle" },
  "incorporation.prepare": { label: "Incorporation preparation", permission: "documents:write", to: "/app/organization-setup" },
  "donation.acknowledge": { label: "Contribution acknowledgements", permission: "financials:write", to: "/app/receipts" },
  "official_receipt.prepare": { label: "Official donation receipt preparation", permission: "financials:write", to: "/app/receipts" },
};
const APPLICABILITY_LABELS = { applies: "Applies", not_applicable: "Does not apply", undetermined: "Applicability needs review" };
const COVERAGE_LABELS = { records_only: "Records only", guided_preparation: "Guidance available", checked_action: "Application checks", unavailable: "Not supported for this action" };
const READINESS_LABELS = { ready: "Available", needs_information: "Information needed", needs_review: "Review needed", blocked: "Cannot proceed yet" };

/** Explains legal coverage without claiming that a record or obligation is complete. */
export function OrganizationCapabilities({ organization, charityRegistrations, assessmentDate }: {
  organization: CapabilityOrganization;
  charityRegistrations?: WorkflowAssessmentOptions["charityRegistrations"];
  assessmentDate?: string;
}) {
  const { loaded, can } = usePermissions();
  const coverage = organizationCapabilities(organization, { charityRegistrations, onDate: assessmentDate ?? todayDateOnly() });
  return (
    <details className="organization-capabilities" data-testid="organization-capabilities">
      <summary>
        <span className="organization-capabilities__heading">Features and next steps for your Act</span>
        <Badge tone={coverage.reviewRequired ? "warn" : "info"}>{coverage.reviewRequired ? "Review needed" : "Core guidance available"}</Badge>
      </summary>
      <div className="organization-capabilities__body">
        <p className="organization-capabilities__identity">{coverage.entityLabel} · {coverage.jurisdictionLabel}<br />{coverage.actLabel}</p>
        {coverage.identity.status !== "recorded" && <div className="organization-capabilities__identity-review" role="status">
          <strong>{coverage.identity.status === "conflict" ? "Resolve conflicting identity records" : "Complete the recorded legal identity"}</strong>
          {coverage.identity.issues.map(issue => <p key={issue.code}>{issue.message}</p>)}
        </div>}
        <dl className="organization-capabilities__coverage">
          <div>
            <dt>Core governance <Badge tone={coverage.governance.supported ? "info" : "warn"}>{coverage.governance.supported ? "Reviewed core" : "Review required"}</Badge></dt>
            <dd>{coverage.governance.message}</dd>
            {coverage.governance.supported && <dd className="organization-capabilities__meta">{coverage.governance.profileName} · Profile reviewed {coverage.governance.reviewedOn}</dd>}
          </div>
          <div>
            <dt>Incorporation preparation <Badge tone={coverage.preparation.supported ? "info" : "warn"}>{coverage.preparation.supported ? "Preparation available" : "Review required"}</Badge></dt>
            <dd>{coverage.preparation.message}</dd>
            {coverage.preparation.reviewedDrafts.length > 0 && <dd>Some separately reviewed drafts are available in the document catalog. This does not enable incorporation preparation.</dd>}
          </div>
        </dl>
        <h3>Workflow availability</h3>
        <p className="organization-capabilities__explanation">Applicability, software support, information and your access are separate. Available guidance does not mark a filing, gift or annual obligation complete.</p>
        <ul className="organization-capabilities__workflows" data-testid="organization-workflows">
          {coverage.workflows.map(workflow => {
            const config = WORKFLOWS[workflow.action];
            const nextAction = workflow.reasons.find(reason => reason.nextAction)?.nextAction;
            const to = nextAction?.startsWith("/app/") ? nextAction
              : nextAction === "review_registration" ? "/app/society#charity-registration"
                : config.to;
            return <li key={workflow.action} data-workflow={workflow.action} data-readiness={workflow.readiness}>
              <div className="organization-capabilities__workflow-heading">
                <h4>{config.label}</h4>
                <Badge tone={workflow.applicability === "applies" ? "info" : "neutral"}>{APPLICABILITY_LABELS[workflow.applicability]}</Badge>
              </div>
              <dl className="organization-capabilities__workflow-facts">
                <div><dt>Software support</dt><dd>{COVERAGE_LABELS[workflow.coverage]}</dd></div>
                <div><dt>Information status</dt><dd>{READINESS_LABELS[workflow.readiness]}</dd></div>
                <div><dt>Your access</dt><dd>{!loaded ? "Checking access" : can(config.permission) ? "Permission available" : "Ask an authorized user"}</dd></div>
              </dl>
              {workflow.reasons.map(reason => <p key={reason.code}>{reason.message}</p>)}
              {workflow.applicability !== "not_applicable" && <Link to={to}>{workflow.readiness === "ready" ? "Open workflow" : "Review next step"}</Link>}
            </li>;
          })}
        </ul>
        <h3>Records and features for this organization</h3>
        <ul className="organization-capabilities__features">
          {coverage.features.map((feature) => <li key={feature.key}><Link to={feature.to}>{feature.title}</Link><p>{feature.detail}</p></li>)}
        </ul>
        {coverage.governance.records.length > 0 && <details className="organization-capabilities__records">
          <summary>Record checklist in this Act's core profile</summary>
          <p>These are the profile's record categories. Conditional records depend on your circumstances; this list does not show completion.</p>
          <ul>{coverage.governance.records.map((record) => <li key={record.key}>
            <span>{record.label}</span> <Badge tone="neutral">{record.requirement === "conditional" ? "When applicable" : record.requirement === "recommended" ? "Recommended evidence" : "Statutory record"}</Badge>
            {record.caveat && <p>{record.caveat}</p>}
          </li>)}</ul>
          {coverage.governance.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
        </details>}
        <h3>What to confirm next</h3>
        <ol className="organization-capabilities__steps">
          {coverage.nextSteps.map((step) => <li key={step.key}><Link to={step.to}>{step.title}</Link><p>{step.detail}</p></li>)}
        </ol>
        <p className="organization-capabilities__note">A profile review date records a review, not a law's effective date. Your setup steps track the evidence; these coverage labels do not certify compliance or registry acceptance.</p>
      </div>
    </details>
  );
}
