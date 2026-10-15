import { CheckCircle2 } from "lucide-react";
import type { OrganizationSetupProgress } from "../../../shared/organizationSetup/types";
import { findSetupStep } from "./useOrganizationSetup";
import { SetupStepActions } from "./SetupStepActions";
import { useSetupView } from "./SetupViewContext";
import { isLifecycleStep } from "./setupCopy";

/** The next recommended step, pinned above the phases. */
export function NextStepCard({ progress }: { progress: OrganizationSetupProgress }) {
  const view = useSetupView();
  const step = findSetupStep(progress, progress.next?.key);

  if (!step) {
    return (
      <section className="setup-next setup-next--done" aria-label="Next step">
        <CheckCircle2 size={20} className="setup-next__done-icon" aria-hidden="true" />
        <div>
          <h2 className="setup-next__title">{progress.complete ? "Setup is complete" : "Nothing left for you here"}</h2>
          <p className="setup-next__description">
            {progress.complete
              ? "Societyer will remind you when yearly tasks are due."
              : "The remaining steps need an owner or admin, or you've put them off for later."}
          </p>
        </div>
      </section>
    );
  }

  const organize = view.waitingForRegistry ? findSetupStep(progress, "organize") : undefined;
  return (
    <section className="setup-next" aria-labelledby="setup-next-title">
      <p className="setup-next__eyebrow">Next step</p>
      <h2 className="setup-next__title" id="setup-next-title">
        <button type="button" className="setup-next__title-link" onClick={() => view.focusStep(step.key)}>
          {step.title}
        </button>
      </h2>
      <p className="setup-next__description">{step.description}</p>
      {step.note && <p className="setup-next__note">{step.note}</p>}
      <div className="setup-next__actions">
        <SetupStepActions step={step} context="next" />
        {view.canWrite && !isLifecycleStep(step) && step.state !== "later" && (
          <button type="button" className="btn btn--ghost setup-next__later" onClick={() => view.decide(step, "later")}>
            Remind me later
          </button>
        )}
      </div>
      {organize && organize.state !== "done" && organize.state !== "not_applicable" && (
        <p className="setup-next__aside">
          While you wait:{" "}
          <button type="button" className="link-button" onClick={() => view.focusStep("organize")}>
            {organize.title.charAt(0).toLowerCase() + organize.title.slice(1)}
          </button>
        </p>
      )}
    </section>
  );
}
