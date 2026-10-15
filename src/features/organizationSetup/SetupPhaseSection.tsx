import { useId } from "react";
import { ChevronDown, Hourglass } from "lucide-react";
import type { SetupPhaseView, SetupStepKey } from "../../../shared/organizationSetup/types";
import { PHASE_STATUS_LABEL } from "./setupCopy";
import { SetupStepRow } from "./SetupStepRow";

/** One phase: a collapsible header with its n/m count, then its steps. */
export function SetupPhaseSection({
  phase,
  number,
  beforeCurrent = false,
  open,
  onToggle,
  openSteps,
  onToggleStep,
  nextKey,
}: {
  phase: SetupPhaseView;
  number: number;
  /** An earlier phase than the current one (open steps there read "Still open"). */
  beforeCurrent?: boolean;
  open: boolean;
  onToggle: () => void;
  openSteps: ReadonlySet<string>;
  onToggleStep: (key: SetupStepKey) => void;
  nextKey?: SetupStepKey;
}) {
  const bodyId = useId();
  const headingId = useId();
  const countLabel = phase.key === "maintain" && phase.status !== "complete" ? null : `${phase.done} of ${phase.total}`;
  return (
    <section
      id={`phase-${phase.key}`}
      className={`setup-phase setup-phase--${phase.status}${open ? " is-open" : ""}`}
      aria-labelledby={headingId}
    >
      <h2 className="setup-phase__heading" id={headingId}>
        <button type="button" className="setup-phase__toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="setup-phase__number" aria-hidden="true">{number}</span>
          <span className="setup-phase__title">{phase.title}</span>
          <span className="setup-phase__meta">
            {phase.statusNote ? (
              <span className="setup-phase__status setup-phase__status--waiting">
                <Hourglass size={12} aria-hidden="true" />
                {phase.statusNote}
              </span>
            ) : (
              <span className={`setup-phase__status setup-phase__status--${phase.status}`}>
                {beforeCurrent && phase.status === "upcoming" ? "Still open" : PHASE_STATUS_LABEL[phase.status]}
              </span>
            )}
            {countLabel && <span className="setup-phase__count">{countLabel}</span>}
          </span>
          <ChevronDown size={16} className="setup-phase__chevron" aria-hidden="true" />
        </button>
      </h2>
      <div id={bodyId} className="setup-phase__body" hidden={!open}>
        <p className="setup-phase__description">{phase.description}</p>
        {phase.steps.length === 0 ? (
          <p className="setup-phase__empty">Nothing to do here for your organization.</p>
        ) : (
          <ol className="setup-phase__steps">
            {phase.steps.map((step) => (
              <SetupStepRow
                key={step.key}
                step={step}
                open={openSteps.has(step.key)}
                isNext={step.key === nextKey}
                onToggle={() => onToggleStep(step.key)}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
