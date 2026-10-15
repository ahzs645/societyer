import { ExternalLink } from "lucide-react";
import type { SetupStepView } from "../../../shared/organizationSetup/types";
import { incorporationPreparationForOrganization } from "../../../shared/incorporationPreparation";
import { useSetupView } from "./SetupViewContext";

/**
 * The filing step: open the registry's own service, then say "I've filed it".
 * "What you'll need" reuses the preparation guide's requirements (the data
 * behind IncorporationPreparation, not its card). While the filing is with
 * the registry it offers the certificate step and an undo instead.
 */
export function FilingStepPanel({ step, context }: { step: SetupStepView; context: "row" | "next" }) {
  const view = useSetupView();
  const guide = incorporationPreparationForOrganization(view.society);

  if (step.state === "done") {
    if (!view.waitingForRegistry) return null;
    return (
      <div className="setup-filing">
        <div className="setup-step__buttons">
          <button type="button" className="btn btn--accent" onClick={() => view.focusStep("certificate")}>
            Record the certificate when it arrives
          </button>
          {view.canWrite && (
            <button type="button" className="btn btn--ghost" onClick={view.undoFiled}>
              Undo — I haven't filed yet
            </button>
          )}
        </div>
      </div>
    );
  }

  const requirements = guide?.requirements ?? [];
  return (
    <div className="setup-filing">
      <div className="setup-step__buttons">
        {step.externalUrl && (
          <a className="btn btn--accent" href={step.externalUrl} target="_blank" rel="noreferrer">
            {step.externalLabel ?? `Open ${view.registry}`}
            <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        <button type="button" className={`btn${step.externalUrl ? "" : " btn--accent"}`} disabled={!view.canWrite} onClick={view.openFiled}>
          I've filed it
        </button>
      </div>
      {!view.canWrite && <p className="setup-step__hint">Only an owner or admin can mark the filing as done.</p>}
      {!step.externalUrl && (
        <p className="setup-step__hint">
          Societyer doesn't have step-by-step guidance for this Act yet. Use the registry's own instructions.
        </p>
      )}
      {context === "row" && requirements.length > 0 && (
        <details className="setup-needs">
          <summary>What you'll need ({requirements.length})</summary>
          <ol className="setup-needs__list">
            {requirements.map((requirement) => (
              <li key={requirement.key}>
                <strong>{requirement.title}</strong>
                <span>{requirement.detail}</span>
              </li>
            ))}
          </ol>
          {guide?.retainedDocuments.length ? (
            <p className="setup-needs__keep">
              <strong>Keep after incorporation:</strong> {guide.retainedDocuments.join(", ")}.
            </p>
          ) : null}
        </details>
      )}
    </div>
  );
}
