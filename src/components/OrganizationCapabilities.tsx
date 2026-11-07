import { Link } from "react-router-dom";
import { organizationCapabilities, type CapabilityOrganization } from "../../shared/organizationCapabilities";
import { Badge } from "./ui";
import "./organizationCapabilities.css";

/** Explains legal coverage without claiming that a record or obligation is complete. */
export function OrganizationCapabilities({ organization }: { organization: CapabilityOrganization }) {
  const coverage = organizationCapabilities(organization);
  return (
    <details className="organization-capabilities" data-testid="organization-capabilities">
      <summary>
        <span className="organization-capabilities__heading">Features and next steps for your Act</span>
        <Badge tone={coverage.reviewRequired ? "warn" : "info"}>{coverage.reviewRequired ? "Review needed" : "Core guidance available"}</Badge>
      </summary>
      <div className="organization-capabilities__body">
        <p className="organization-capabilities__identity">{coverage.entityLabel} · {coverage.jurisdictionLabel}<br />{coverage.actLabel}</p>
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
