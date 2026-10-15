import {
  ORGANIZATION_SETUP_PATH,
  setupStepHref,
  type OrganizationSetupProgress,
  type SetupStepKey,
  type SetupStepView,
} from "../../shared/organizationSetup/types";

/**
 * Small helpers shared by the setup surfaces outside the setup view itself:
 * the Dashboard summary card, the shell pill and the "Back to setup" banner.
 */

/** Where a step sends the viewer: its destination page (carrying `?setup=`), or the step inside the setup view. */
export function setupStepLink(step: Pick<SetupStepView, "key" | "to">): string {
  return step.to ? setupStepHref(step.to, step.key) : setupViewStepLink(step.key);
}

/** The step's place in the setup view (the view scrolls to it and opens it). */
export function setupViewStepLink(key: SetupStepKey | string): string {
  return `${ORGANIZATION_SETUP_PATH}#step-${encodeURIComponent(key)}`;
}

export function findSetupStep(progress: OrganizationSetupProgress | undefined, key: string | null | undefined): SetupStepView | undefined {
  if (!progress || !key) return undefined;
  for (const phase of progress.phases) {
    const step = phase.steps.find((candidate) => candidate.key === key);
    if (step) return step;
  }
  return undefined;
}

export function setupPercent(progress: Pick<OrganizationSetupProgress, "counts">): number {
  const { done, total } = progress.counts;
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/**
 * Card and pill title. Before incorporation it talks about getting ready, never
 * about good standing: the organization doesn't exist yet.
 */
export function setupSummaryTitle(progress: Pick<OrganizationSetupProgress, "variant" | "currentPhase">, name: string | undefined): string {
  const subject = name?.trim() || "your organization";
  if (progress.variant === "existing") return `Finish setting up ${subject}`;
  if (progress.currentPhase === "prepare" || progress.currentPhase === "file") return `Getting ${subject} ready to incorporate`;
  if (progress.currentPhase === "organize") return `Organizing ${subject}`;
  return `Finish setting up ${subject}`;
}

export function isOrganizationSetupPath(pathname: string): boolean {
  const path = pathname.toLowerCase().replace(/\/+$/, "");
  return path === ORGANIZATION_SETUP_PATH || path.startsWith(`${ORGANIZATION_SETUP_PATH}/`);
}
