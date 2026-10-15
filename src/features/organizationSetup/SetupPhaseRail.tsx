import { CheckCircle2, Circle, CircleDot, Repeat } from "lucide-react";
import type { OrganizationSetupProgress, SetupPhaseKey, SetupPhaseView } from "../../../shared/organizationSetup/types";

function PhaseIcon({ status }: { status: SetupPhaseView["status"] }) {
  if (status === "complete") return <CheckCircle2 size={16} />;
  if (status === "current") return <CircleDot size={16} />;
  if (status === "ongoing") return <Repeat size={14} />;
  return <Circle size={16} />;
}

/**
 * Phase navigation: a sticky rail beside the steps on desktop, a row of
 * scrolling chips on phones and tablets (same markup; CSS changes the axis).
 */
export function SetupPhaseRail({
  progress,
  activePhase,
  onSelect,
}: {
  progress: OrganizationSetupProgress;
  activePhase?: SetupPhaseKey;
  onSelect: (key: SetupPhaseKey) => void;
}) {
  return (
    <nav className="setup-rail" aria-label="Setup phases">
      <ol className="setup-rail__list">
        {progress.phases.map((phase, index) => {
          const counted = !(phase.key === "maintain" && phase.status !== "complete");
          return (
            <li key={phase.key}>
              <button
                type="button"
                className={`setup-rail__item setup-rail__item--${phase.status}${activePhase === phase.key ? " is-active" : ""}`}
                aria-current={phase.key === progress.currentPhase ? "step" : undefined}
                onClick={() => onSelect(phase.key)}
              >
                <span className="setup-rail__icon" aria-hidden="true"><PhaseIcon status={phase.status} /></span>
                <span className="setup-rail__text">
                  <span className="setup-rail__title">
                    <span className="setup-rail__number">{index + 1}</span> {phase.title}
                  </span>
                  {phase.statusNote ? (
                    <span className="setup-rail__note">{phase.statusNote}</span>
                  ) : phase.key === "maintain" && phase.status === "upcoming" ? (
                    <span className="setup-rail__note">Starts after incorporation</span>
                  ) : null}
                </span>
                {counted && (
                  <span className="setup-rail__count">
                    {phase.done}/{phase.total}
                    <span className="sr-only"> done</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
