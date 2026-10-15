import { Link } from "react-router-dom";
import type { SetupStepView } from "../../../shared/organizationSetup/types";
import { setupStepLink } from "./useOrganizationSetup";
import { useSetupView } from "./SetupViewContext";

/** The name step's two routes: a registry-assigned numbered name, or a name search. */
export function NameStepChoice({ step }: { step: SetupStepView }) {
  const view = useSetupView();
  const href = setupStepLink(step);
  return (
    <div className="setup-step__buttons">
      <button type="button" className="btn btn--accent" disabled={!view.canWrite} onClick={view.chooseNumberedName}>
        Use a numbered name
      </button>
      {href && (
        <Link className="btn" to={href}>
          {step.actionLabel ?? "Record a name search"}
        </Link>
      )}
    </div>
  );
}
