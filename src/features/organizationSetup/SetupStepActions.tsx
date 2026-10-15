import { Link } from "react-router-dom";
import { ArrowRight, Lock } from "lucide-react";
import type { SetupStepView } from "../../../shared/organizationSetup/types";
import { setupStepLink } from "./useOrganizationSetup";
import { useSetupView } from "./SetupViewContext";
import { FilingStepPanel } from "./FilingStepPanel";
import { NameStepChoice } from "./NameStepChoice";

/**
 * The step's primary action: a link that carries `?setup=<key>` (so the
 * destination page can offer "Back to setup"), or an inline lifecycle action
 * for filing, the certificate and the name choice.
 */
export function SetupStepActions({ step, context }: { step: SetupStepView; context: "row" | "next" }) {
  const view = useSetupView();
  if (step.state === "restricted") {
    return (
      <p className="setup-step__restricted">
        <Lock size={14} aria-hidden="true" />
        Ask an owner or admin to do this. You don't have access to that page.
      </p>
    );
  }
  if (step.action === "mark_submitted") return <FilingStepPanel step={step} context={context} />;
  if (step.action === "choose_name" && step.state !== "done") return <NameStepChoice step={step} />;
  if (step.action === "record_certificate") {
    if (step.state === "done") return null;
    return (
      <div className="setup-step__buttons">
        <button type="button" className="btn btn--accent" disabled={!view.canWrite} onClick={view.openCertificate}>
          Record the certificate
        </button>
        {!view.canWrite && <span className="setup-step__hint">Only an owner or admin can record the certificate.</span>}
      </div>
    );
  }
  const href = setupStepLink(step);
  if (!href) return null;
  const done = step.state === "done";
  return (
    <div className="setup-step__buttons">
      <Link className={`btn${done ? "" : " btn--accent"}`} to={href}>
        {done ? "Open" : step.actionLabel ?? "Open"}
        {!done && <ArrowRight size={14} aria-hidden="true" />}
      </Link>
    </div>
  );
}
