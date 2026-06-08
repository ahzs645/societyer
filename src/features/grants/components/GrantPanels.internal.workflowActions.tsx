// GrantPanels: next-steps and operational workflow panels with action links.
import { type ReactNode, useEffect, useState } from "react";
import { ExternalLink, ListChecks, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Field, InspectorNote } from "../../../components/ui";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { StructuredAddressFields } from "../../../components/StructuredAddressFields";
import { formatDate, money } from "../../../lib/format";
import {
  asAnswerLibrary,
  asComplianceFlags,
  asContacts,
  asNextSteps,
  asRequirements,
  asTimelineEvents,
  asUseOfFunds,
  cleanStringList,
  detectRequirementTemplateKey,
  GRANT_REQUIREMENT_TEMPLATES,
  type GrantRequirement,
  type GrantRequirementStatus,
  mergeTemplateRequirements,
  optionalString,
  REQUIREMENT_STATUSES,
  requirementStatusTone,
  requirementSummary,
  requirementTemplateCoverage,
  type RequirementTemplateKey,
} from "../lib/grantDrafts";

import {
  nextStepStyle,
  nextStepTone,
  priorityTone,
  workflowActionBarStyle,
} from "./GrantPanels.internal.styles";
import {
  DossierSection,
} from "./GrantPanels.internal.dossierPanels";
import {
  EMP5616_FORM_URL,
  GCOS_EED_ADD_URL,
  GCOS_EED_MANAGE_URL,
} from "./GrantPanels.internal.editorForm";

export function GrantNextStepsPanel({ grant }: { grant: any }) {
  const steps = asNextSteps(grant.nextSteps).filter((step) => step.label.trim());
  if (steps.length === 0) return null;

  return (
    <DossierSection title="Recommended Next Steps">
      <div style={{ display: "grid", gap: 8 }}>
        {steps.map((step) => {
          const actions = workflowActionsForStep(grant, step);
          return (
            <div key={step.id} style={nextStepStyle}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{step.label}</strong>
                  {step.reason && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{step.reason}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Badge tone={nextStepTone(step.status)}>{step.status}</Badge>
                  <Badge tone={priorityTone(step.priority)}>{step.priority}</Badge>
                </div>
              </div>
              {actions.length > 0 && (
                <div style={workflowActionBarStyle}>
                  {actions.map((action) => action.external ? (
                    <a
                      key={action.label}
                      className={action.primary ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
                      href={action.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {action.label}
                      <ExternalLink size={11} />
                    </a>
                  ) : action.href.startsWith("#") ? (
                    <a key={action.label} className={action.primary ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"} href={action.href}>
                      {action.label}
                    </a>
                  ) : (
                    <Link key={action.label} className={action.primary ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"} to={action.href}>
                      {action.label}
                    </Link>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
                {step.dueHint && <span className="muted">{step.dueHint}</span>}
                {step.sourceUrl ? (
                  <a className="muted" href={step.sourceUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Source: {step.source ?? "source"}
                    <ExternalLink size={11} />
                  </a>
                ) : step.source ? (
                  <span className="muted">Source: {step.source}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </DossierSection>
  );
}

export function GrantOperationalWorkflowsPanel({ grant }: { grant: any }) {
  const isCsj = /canada summer jobs|csj/i.test(`${grant.program ?? ""} ${cleanStringList(grant.keyFacts).join(" ")}`);
  if (!isCsj) return null;

  return (
    <DossierSection title="Grant Workflows">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={nextStepStyle}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <strong>CSJ remote worker orientation</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                System workflow for the Young Workers attestation: queue the resource email, review it during orientation, then retain evidence before submitting EED.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Badge tone="info">System workflow</Badge>
              <Badge tone="warn">EED evidence</Badge>
            </div>
          </div>
          <div style={workflowActionBarStyle}>
            <Link className="btn btn--accent btn--sm" to={String(grant.id ?? grant._id ?? "") ? `/app/grants/${String(grant.id ?? grant._id)}#funded-employees` : "#funded-employees"}>Queue for employee</Link>
            <Link className="btn btn--ghost btn--sm" to="/app/outbox">Open Outbox</Link>
            <Link className="btn btn--ghost btn--sm" to="/app/workflows">Workflow catalog</Link>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Supports the GCOS checkbox: “I confirm that I have read the information on the Young Workers website and I have provided the link to the employee.”
          </div>
        </div>
      </div>
    </DossierSection>
  );
}

export function workflowActionsForStep(grant: any, step: ReturnType<typeof asNextSteps>[number]) {
  const grantId = String(grant.id ?? grant._id ?? "");
  const editHref = grantId ? `/app/grants/${grantId}/edit` : "/app/grants";
  const checklistHref = grantId ? `/app/grants/${grantId}/edit#grant-edit-readiness` : "#grant-edit-readiness";
  const fundingHref = grantId ? `/app/grants/${grantId}/edit#grant-edit-status` : "#grant-edit-status";
  const reportingHref = grantId ? `/app/grants/${grantId}/edit#grant-edit-timeline` : "#grant-edit-timeline";
  const actions: Array<{ label: string; href: string; external?: boolean; primary?: boolean }> = [];

  if (step.id === "gcos-prepare-eed") {
    const emp5616 = findRequirementById(grant.requirements, "gcos-emp5616-consent");
    actions.push(
      { label: "Link employees", href: grantId ? `/app/grants/${grantId}#funded-employees` : "#funded-employees", primary: true },
      { label: "Open EMP5616", href: emp5616?.documentUrl ?? EMP5616_FORM_URL, external: true },
      { label: "Add EED in GCOS", href: step.actionUrl ?? GCOS_EED_ADD_URL, external: true },
      { label: "Track checklist", href: checklistHref },
    );
    actions.push({ label: "View EED list", href: GCOS_EED_MANAGE_URL, external: true });
  } else if (step.id === "gcos-complete-emp5616") {
    actions.push({ label: step.actionLabel ?? "Open EMP5616", href: step.actionUrl ?? EMP5616_FORM_URL, external: true, primary: true });
    actions.push(
      { label: "Link employee record", href: grantId ? `/app/grants/${grantId}#funded-employees` : "#funded-employees" },
      { label: "Mark consent retained", href: checklistHref },
    );
  } else if (step.id === "gcos-review-award-delta") {
    actions.push(
      { label: "Review funding delta", href: fundingHref, primary: true },
      { label: "Update budget notes", href: fundingHref },
    );
  } else if (step.id === "gcos-plan-payment-claim") {
    actions.push(
      { label: "Create reporting plan", href: reportingHref, primary: true },
      { label: "Review evidence checklist", href: checklistHref },
    );
  } else if (step.actionUrl) {
    actions.push({ label: step.actionLabel ?? "Open action", href: step.actionUrl, external: true, primary: true });
  } else if (step.actionLabel) {
    actions.push({ label: step.actionLabel, href: editHref, primary: true });
  }

  return actions;
}

export function findRequirementById(value: unknown, id: string) {
  return asRequirements(value).find((requirement) => requirement.id === id);
}
