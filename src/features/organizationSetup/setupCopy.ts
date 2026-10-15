import type { OrganizationSetupProgress, SetupPhaseView, SetupStepState, SetupStepView } from "../../../shared/organizationSetup/types";
import { formatDate } from "../../lib/format";
import { jurisdictionModuleContract } from "../../../shared/jurisdictionWorkspace";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isCorporation, type LegalEntityLike } from "../../../shared/organizationDomain";

/** Who the organization files with: "Corporations Canada", "BC Registries", … */
export function registryNameFor(organization: LegalEntityLike | null | undefined): string {
  if (!organization) return "the registry";
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  if (code === "CA-FED-CBCA") return "Corporations Canada";
  if (!isCorporation(organization) && code === "CA-BC") return "BC Registries";
  const label = jurisdictionModuleContract(code as any).registryPortalLabel;
  return label && label !== "Registry" ? label : "the registry";
}

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

/** Preset reasons for "Doesn't apply to us" (plus Other with free text). */
export const NOT_APPLICABLE_REASONS = [
  "No one owns 25% or more",
  "We only operate in one province",
  "Not needed for our organization",
] as const;

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

/** "Getting ready to incorporate", "Filed — waiting for …", "Incorporated on …". */
export function setupStageLabel(progress: OrganizationSetupProgress, society: { certificateDate?: string | null } | null | undefined): string {
  const filePhase = progress.phases.find((phase) => phase.key === "file");
  const certificate = progress.phases.flatMap((phase) => phase.steps).find((step) => step.key === "certificate");
  const certified = certificate?.state === "done";
  const date = society?.certificateDate ? formatDate(society.certificateDate) : "";
  if (progress.variant === "existing") {
    return certified ? (date ? `Incorporated on ${date}` : "Incorporated") : "Already incorporated — certificate not uploaded yet";
  }
  if (certified) return date ? `Incorporated on ${date}` : "Incorporated";
  if (filePhase?.statusNote) return `Filed — ${lowerFirst(filePhase.statusNote)}`;
  return "Getting ready to incorporate";
}

function lowerFirst(value: string) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

/** Phase number (1-based) for display. */
export function phaseNumber(progress: OrganizationSetupProgress, key: string): number {
  return progress.phases.findIndex((phase) => phase.key === key) + 1;
}
