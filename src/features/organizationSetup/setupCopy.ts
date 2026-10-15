import type { OrganizationSetupProgress, SetupPhaseView, SetupStepState, SetupStepView } from "../../../shared/organizationSetup/types";

/** Short state label shown on each step row. */
export const STEP_STATE_LABEL: Record<SetupStepState, string> = {
  done: "Done",
  in_progress: "In progress",
  todo: "To do",
  later: "Later",
  not_applicable: "Doesn't apply",
  restricted: "Ask an owner or admin",
};

export const PHASE_STATUS_LABEL: Record<SetupPhaseView["status"], string> = {
  complete: "Complete",
  current: "Current",
  upcoming: "Coming up",
  ongoing: "Ongoing",
};

/** Lifecycle steps move the organization through filing; they are never put off. */
export function isLifecycleStep(step: Pick<SetupStepView, "action">): boolean {
  return step.action === "mark_submitted" || step.action === "record_certificate";
}

/** The step can be put off or marked as not applying (and those decisions undone). */
export function canDecideStep(step: SetupStepView): boolean {
  if (step.state === "done") return false;
  if (step.state === "later" || step.state === "not_applicable") return true;
  return !isLifecycleStep(step) || step.allowNotApplicable;
}

/** Phase number (1-based) for display. */
export function phaseNumber(progress: OrganizationSetupProgress, key: string): number {
  return progress.phases.findIndex((phase) => phase.key === key) + 1;
}
