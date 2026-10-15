/**
 * Shared contract for organization setup (`/app/organization-setup`): the
 * step catalogue, the pure evaluator, the `organizationSetup:progress` query,
 * the setup view, the Dashboard summary, the shell pill and the "Back to
 * setup" banner all speak these types.
 */

/** Which set of phases applies (see `setupVariant`). */
export type SetupVariant = "corporation_preparing" | "society_preparing" | "existing";

export type SetupPhaseKey = "prepare" | "file" | "organize" | "maintain";

export type SetupStepKey =
  // Before filing
  | "act" | "name" | "office" | "records-office" | "directors" | "shares" | "isc" | "articles" | "review"
  | "constitution" | "bylaws"
  // Filing
  | "file"
  // After the certificate
  | "certificate" | "organize" | "officers" | "issue-shares" | "registers" | "isc-register" | "business-number"
  | "provinces" | "access" | "members" | "first-meeting" | "tax"
  // Existing organizations
  | "number" | "owners" | "governing-docs" | "minute-book"
  // Ongoing
  | "fiscal-year" | "annual-meeting" | "agm" | "calendar" | "privacy" | "meetings" | "filings";

/**
 * done            the record exists (computed, never ticked)
 * in_progress     a draft or partial record exists
 * todo            nothing yet
 * later           "Remind me later": counted, but never the next step
 * not_applicable  "Doesn't apply to us" with a reason: not counted
 * restricted      the viewer can't open the destination ("Ask an owner or admin")
 */
export type SetupStepState = "done" | "in_progress" | "todo" | "later" | "not_applicable" | "restricted";

/** A stored skip decision (`societies.setupStepDecisions`). */
export type SetupStepDecision = {
  stepKey: SetupStepKey;
  decision: "not_applicable" | "later";
  reason?: string;
  decidedAtISO: string;
  decidedByUserId?: string;
};

/** Inline lifecycle actions the view renders instead of a link. */
export type SetupStepAction = "choose_name" | "mark_submitted" | "record_certificate";

export type SetupStepView = {
  key: SetupStepKey;
  phase: SetupPhaseKey;
  title: string;
  description: string;
  state: SetupStepState;
  /** Short status line, e.g. "Working name saved: Maple Inc." or the skip reason. */
  note?: string;
  optional: boolean;
  /** "Doesn't apply to us" is offered (needs a reason). */
  allowNotApplicable: boolean;
  /** Destination page; the view appends `setup=<key>` for the return banner. */
  to?: string;
  /** Label for the primary link or action, e.g. "Add directors". */
  actionLabel?: string;
  action?: SetupStepAction;
  /** Official registry link for the filing step. */
  externalUrl?: string;
  externalLabel?: string;
};

export type SetupPhaseView = {
  key: SetupPhaseKey;
  title: string;
  description: string;
  /** Done steps / applicable steps (not_applicable excluded). */
  done: number;
  total: number;
  status: "complete" | "current" | "upcoming" | "ongoing";
  /** e.g. "Waiting for Corporations Canada" while the filing is submitted. */
  statusNote?: string;
  steps: SetupStepView[];
};

export type OrganizationSetupProgress = {
  variant: SetupVariant;
  currentPhase: SetupPhaseKey;
  phases: SetupPhaseView[];
  /** The next recommended step for this viewer, if any. */
  next?: { key: SetupStepKey; title: string; to?: string; action?: SetupStepAction };
  /** Over phases prepare..organize (maintain is ongoing and excluded). */
  counts: { done: number; total: number };
  /** True when every counted step is done or decided. */
  complete: boolean;
  /** Plain-language lines describing the answers saved at creation. */
  savedAnswers?: string[];
};

/** Route of the setup view, and the query param destination links carry. */
export const ORGANIZATION_SETUP_PATH = "/app/organization-setup";
export const SETUP_RETURN_PARAM = "setup";

export function setupStepHref(to: string, key: SetupStepKey): string {
  return `${to}${to.includes("?") ? "&" : "?"}${SETUP_RETURN_PARAM}=${encodeURIComponent(key)}`;
}
