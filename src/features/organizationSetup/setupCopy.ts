import type { OrganizationSetupProgress, SetupPhaseView, SetupStepState, SetupStepView } from "../../../shared/organizationSetup/types";
import { formatDecisionExpected } from "../../../shared/nameRequests";

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

/**
 * The step's note as this viewer reads it: a time in it ("decision expected
 * Nov 18, 2:00 p.m. PST") on the viewer's own clock, not the organization's.
 */
export function stepNoteText(step: Pick<SetupStepView, "note" | "noteParts">): string | undefined {
  if (!step.note || !step.noteParts?.length) return step.note;
  return step.noteParts.map((part) => ("at" in part ? formatDecisionExpected(part.at) : part.text)).join("");
}

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
