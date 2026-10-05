import { Link } from "react-router-dom";
import { usePermissions } from "../hooks/usePermissions";
import { isCorporation } from "../../shared/organizationDomain";
import { onboardingGovernanceSummary, readOnboardingAnswersJson } from "../../shared/onboarding";
import { IncorporationPreparation } from "./IncorporationPreparation";

/** Real module destinations keep initial setup usable without a workflow runner. */
export function OrganizationOnboardingPanel({ organization }: { organization: Record<string, any> }) {
  const permissions = usePermissions();
  const corporate = isCorporation(organization);
  let answers;
  try { answers = readOnboardingAnswersJson(organization.onboardingAnswersJson); } catch { answers = undefined; }
  const steps = [
    { title: "Review organization profile", path: "/app/society", permission: "society:read", detail: "Check the legal name, governing Act, dates and contact details." },
    { title: "Confirm registered locations", path: "/app/organization-details", permission: "society:read", detail: "Review the registered office, mailing address and records location." },
    { title: "Upload governance documents", path: "/app/documents", permission: "documents:read", detail: corporate ? "Keep the official certificate, articles, bylaws and signed agreements." : "Keep the official certificate, constitution and bylaws." },
    ...(corporate ? [
      { title: "Add directors, officers and shareholders", path: "/app/role-holders", permission: "society:read", detail: "Add actual legal role holders from the company's records." },
      { title: "Review share classes and securities", path: "/app/rights-ledger", permission: "society:read", detail: "Confirm authorized share rights before recording actual issuances or transfers." },
    ] : [
      { title: "Review membership types and add members", path: "/app/members", permission: "members:read", detail: "Use the society's membership register and confirm eligibility and voting rights against its bylaws." },
      { title: "Add society directors", path: "/app/directors", permission: "directors:read", detail: "Maintain the actual society director register separately from member and application access records." },
    ]),
    { title: "Set workspace access", path: "/app/users", permission: "users:read", detail: "Invite or link people to Societyer roles. Legal appointments and membership do not automatically grant app access." },
    { title: "Review formation and filing pathway", path: "/app/formation-maintenance", permission: "society:read", detail: "Follow applicable preparation and maintenance steps. Registry filing and official certificate verification remain separate actions." },
    { title: "Work through onboarding tasks", path: "/app/tasks", permission: "tasks:read", detail: "Assign the saved setup checklist, gather missing information and track completion." },
  ];
  return <section className="card organization-onboarding-panel" aria-labelledby="organization-onboarding-title">
    <div className="card__head"><div><h2 id="organization-onboarding-title" className="card__title">Continue organization setup</h2><span className="card__subtitle">Complete these steps in the workspace. A workflow execution service is not required.</span></div></div>
    <div className="card__body">
      <p><strong>{organization.name}</strong> — {organization.formationStatus === "incorporated" ? "incorporation evidence recorded" : organization.formationStatus === "preparing" ? "preparing incorporation" : "official incorporation evidence needs verification"}.</p>
      {answers && <details open><summary>Saved initial setup answers</summary><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{onboardingGovernanceSummary(answers, organization)}</p><p className="muted">These are your initial setup answers. Verify them against the current profile and governing documents before acting.</p></details>}
      <ol className="organization-onboarding-panel__steps">
        {steps.filter((step) => permissions.can(step.permission)).map((step) => <li key={step.title}><Link to={step.path}>{step.title}</Link><p className="muted">{step.detail}</p></li>)}
      </ol>
      <p className="muted">Creating this workspace and its document drafts does not complete incorporation or submit a registry filing. Upload and verify official evidence separately.</p>
      {organization.formationStatus === "preparing" && <details><summary>Official filing channels and information to prepare</summary><IncorporationPreparation organization={organization} /></details>}
    </div>
  </section>;
}
