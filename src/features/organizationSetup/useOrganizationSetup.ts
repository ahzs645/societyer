import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import {
  setupStepHref,
  type OrganizationSetupProgress,
  type SetupPhaseView,
  type SetupStepKey,
  type SetupStepView,
} from "../../../shared/organizationSetup/types";

/**
 * Setup progress for one workspace: phases, steps with computed state, the
 * next recommended step and the done/total count. One query feeds the setup
 * view, the Dashboard summary card, the shell pill and the "Back to setup"
 * banner. `undefined` while loading (or when `societyId` is missing).
 */
export function useOrganizationSetup(societyId: string | null | undefined): OrganizationSetupProgress | undefined {
  return useQuery(api.organizationSetup.progress, societyId ? { societyId } : "skip") as OrganizationSetupProgress | undefined;
}

/** Every step of the progress, in phase order. */
export function allSetupSteps(progress: OrganizationSetupProgress | undefined): SetupStepView[] {
  return progress?.phases.flatMap((phase) => phase.steps) ?? [];
}

export function findSetupStep(progress: OrganizationSetupProgress | undefined, key: SetupStepKey | string | null | undefined): SetupStepView | undefined {
  if (!key) return undefined;
  return allSetupSteps(progress).find((step) => step.key === key);
}

export function findSetupPhase(progress: OrganizationSetupProgress | undefined, key: string | null | undefined): SetupPhaseView | undefined {
  return progress?.phases.find((phase) => phase.key === key);
}

/** The step's destination with `?setup=<key>`, so the shell can offer "Back to setup". */
export function setupStepLink(step: Pick<SetupStepView, "key" | "to">): string | undefined {
  return step.to ? setupStepHref(step.to, step.key) : undefined;
}

/** Whole-number percent of counted steps that are done. */
export function setupPercent(progress: OrganizationSetupProgress | undefined): number {
  if (!progress || progress.counts.total === 0) return 0;
  return Math.round((progress.counts.done / progress.counts.total) * 100);
}
