/**
 * SIGNIFICANT INDIVIDUALS — Transparency Register (pure logic).
 *
 * Models a BC-style Transparency Register of Significant Individuals
 * (the YCN DB_GLOB_TRANSPARENCY_REG + TRANSPARENCY_DUE idea). A significant
 * individual is one who, by ownership / control / influence, must be disclosed
 * on the corporation's transparency register. This module is framework-free
 * (no convex/react imports) and is gated to the corporations track at the call
 * site, but the logic itself is generic.
 *
 * Schema linkage: significant individuals correspond to roleHolders rows with
 * roleType 'controller'. This module deals in the plain disclosure shape rather
 * than the storage row so it can be reused for form metadata and reporting.
 */

export type TaxResidency = "yes" | "no" | "unknown";

export interface SignificantIndividual {
  name: string;
  address?: string;
  dateOfBirth?: string;
  citizenship?: string;
  taxResidentHomeJurisdiction?: TaxResidency;
  /** ISO date the individual became significant. */
  becameSignificantOn: string;
  /** ISO date the individual ceased to be significant, or null/undefined if ongoing. */
  ceasedSignificantOn?: string | null;
  /** The basis for significance (e.g. shareholding, voting control, influence). */
  reason: string;
}

export type SignificanceStatus = "current" | "former" | "upcoming";

/**
 * Derive an individual's significance status relative to a point in time.
 * - 'upcoming' if they have not yet become significant (becameSignificantOn > asOf)
 * - 'former'   if they have ceased (ceasedSignificantOn set and <= asOf)
 * - 'current'  otherwise
 */
export function deriveSignificanceStatus(
  si: SignificantIndividual,
  asOfISO: string,
): SignificanceStatus {
  if (si.becameSignificantOn > asOfISO) {
    return "upcoming";
  }
  if (si.ceasedSignificantOn != null && si.ceasedSignificantOn <= asOfISO) {
    return "former";
  }
  return "current";
}

/** Filter to the individuals who are 'current' as of a point in time. */
export function currentSignificantIndividuals(
  list: SignificantIndividual[],
  asOfISO: string,
): SignificantIndividual[] {
  return list.filter((si) => deriveSignificanceStatus(si, asOfISO) === "current");
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

function isIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Validate a significant individual disclosure. Requires name, reason, and a
 * well-formed becameSignificantOn ISO date; if a ceasedSignificantOn is present
 * it must not precede becameSignificantOn.
 */
export function validateSignificantIndividual(
  si: SignificantIndividual,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!si.name || si.name.trim() === "") {
    errors.push("name is required");
  }
  if (!si.reason || si.reason.trim() === "") {
    errors.push("reason is required");
  }
  if (!si.becameSignificantOn || si.becameSignificantOn.trim() === "") {
    errors.push("becameSignificantOn is required");
  } else if (!isIsoDate(si.becameSignificantOn)) {
    errors.push("becameSignificantOn must be an ISO date");
  }

  if (si.ceasedSignificantOn != null && si.ceasedSignificantOn.trim() !== "") {
    if (!isIsoDate(si.ceasedSignificantOn)) {
      errors.push("ceasedSignificantOn must be an ISO date");
    } else if (
      si.becameSignificantOn &&
      isIsoDate(si.becameSignificantOn) &&
      si.ceasedSignificantOn < si.becameSignificantOn
    ) {
      errors.push("ceasedSignificantOn must not be before becameSignificantOn");
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * The diligence sub-register: a record of the reasonable steps taken to
 * identify and confirm a significant individual, plus a scheduled review.
 */
export interface SignificanceStep {
  individualName: string;
  stepsNarrative: string;
  stepDate: string;
  nextReviewDate?: string;
}

/** Diligence steps whose scheduled review is due (nextReviewDate set and <= asOf). */
export function reviewsDue(
  steps: SignificanceStep[],
  asOfISO: string,
): SignificanceStep[] {
  return steps.filter(
    (step) => step.nextReviewDate != null && step.nextReviewDate <= asOfISO,
  );
}

// ---------------------------------------------------------------------------
// Structured transparency particulars (BC Business Corporations Act Part 4.1).
// ---------------------------------------------------------------------------

/**
 * s. 119.2 (2) (b): whether the individual is a Canadian citizen or a
 * permanent resident of Canada. "neither" requires the countries of
 * citizenship (s. 119.2 (2) (c)); "unknown" records an unconfirmed fact.
 */
export type CanadianStatus = "citizen" | "permanent_resident" | "neither" | "unknown";
export const CANADIAN_STATUS_OPTIONS: ReadonlyArray<{ value: CanadianStatus; label: string }> = [
  { value: "citizen", label: "Canadian citizen" },
  { value: "permanent_resident", label: "Permanent resident of Canada" },
  { value: "neither", label: "Neither (list every country of citizenship)" },
  { value: "unknown", label: "Not yet confirmed" },
];

/** How an individual is significant: the s. 119.11 categories. */
export type SignificanceBasis =
  | "shares_registered"
  | "shares_beneficial"
  | "shares_indirect_control"
  | "directors_right"
  | "directors_indirect_control"
  | "directors_influence"
  | "prescribed"
  | "joint_interest"
  | "acting_together";
export const SIGNIFICANCE_BASIS_OPTIONS: ReadonlyArray<{ value: SignificanceBasis; label: string; section: string }> = [
  { value: "shares_registered", label: "Registered owner of a significant number of shares", section: "s. 119.11 (2) (a) (i)" },
  { value: "shares_beneficial", label: "Beneficial owner of a significant number of shares", section: "s. 119.11 (2) (a) (ii)" },
  { value: "shares_indirect_control", label: "Indirect control of a significant number of shares", section: "s. 119.11 (2) (a) (iii)" },
  { value: "directors_right", label: "Right to elect, appoint or remove a majority of directors", section: "s. 119.11 (2) (b) (i)" },
  { value: "directors_indirect_control", label: "Indirect control of that right over a majority of directors", section: "s. 119.11 (2) (b) (ii)" },
  { value: "directors_influence", label: "Direct and significant influence over a person with that right", section: "s. 119.11 (2) (b) (iii)" },
  { value: "prescribed", label: "Prescribed interest, right, ability or circumstance", section: "s. 119.11 (2) (c)" },
  { value: "joint_interest", label: "Interest or right held jointly with others", section: "s. 119.11 (3)" },
  { value: "acting_together", label: "Combined interests under an agreement to act together, or as associates", section: "s. 119.11 (4)" },
];

export function isSignificanceBasis(value: unknown): value is SignificanceBasis {
  return SIGNIFICANCE_BASIS_OPTIONS.some((option) => option.value === value);
}

/** Problems with the structured particulars (blocking only for impossible combinations). */
export function transparencyParticularProblems(row: { canadianStatus?: string; citizenshipCountries?: readonly string[]; significanceBases?: readonly string[] }): string[] {
  const problems: string[] = [];
  if (row.canadianStatus !== undefined && !CANADIAN_STATUS_OPTIONS.some((option) => option.value === row.canadianStatus)) {
    problems.push("Choose whether the individual is a Canadian citizen, a permanent resident, neither, or not yet confirmed.");
  }
  for (const basis of row.significanceBases ?? []) {
    if (!isSignificanceBasis(basis)) problems.push(`"${basis}" is not a recognised basis of significance.`);
  }
  return problems;
}

/** Review notes (non-blocking) for the structured particulars. */
export function transparencyParticularNotes(row: { canadianStatus?: string; citizenshipCountries?: readonly string[] }): string[] {
  if (row.canadianStatus === "neither" && !(row.citizenshipCountries ?? []).some((country) => String(country).trim())) {
    return ["Record every country of which the individual is a citizen (s. 119.2 (2) (c)), or the steps taken to obtain it (s. 119.2 (4))."];
  }
  return [];
}

/**
 * Date of birth for display: masked unless the viewer may see the full
 * transparency register (directors and inspecting officials only, s. 119.61).
 */
export function displayDateOfBirth(dateOfBirth: string | undefined | null, revealed: boolean): string {
  if (!dateOfBirth) return "";
  return revealed ? dateOfBirth : "Restricted";
}

/**
 * s. 119.4: within one year after the sixth anniversary of the entry showing
 * the individual ceased to be significant, delete the information and destroy
 * the related records. Returns the window, or null without a valid entry date.
 */
export function transparencyDisposalWindow(ceasedEntryDate: string | undefined | null): { opensOn: string; dueBy: string } | null {
  if (typeof ceasedEntryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ceasedEntryDate)) return null;
  const [y, m, d] = ceasedEntryDate.split("-").map(Number);
  const at = (years: number) => {
    const year = y + years;
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  };
  return { opensOn: at(6), dueBy: at(7) };
}

// ---------------------------------------------------------------------------
// Candidate significant individuals from the share register.
// ---------------------------------------------------------------------------

/** Holder roll-up as produced by computeVotingPower (shared/votingPower.ts). */
export interface CandidateHolderInput {
  holderKey: string;
  holderName: string;
  totalShares: number;
  totalVotes: number;
}

export interface CandidateHolderFacts {
  /** false for a corporation, trust or other non-individual holder. */
  isIndividual?: boolean;
  /** Already recorded on the register as a significant individual. */
  recorded?: boolean;
}

export type CandidateBasis = "issued_shares_25" | "votes_25";

export interface SignificantIndividualCandidate {
  holderKey: string;
  holderName: string;
  totalShares: number;
  totalVotes: number;
  percentOfShares: number;
  percentOfVotes: number;
  bases: CandidateBasis[];
  holderType: "individual" | "non_individual";
  /** review: confirm and record the individual. look_through: identify the individuals behind this holder. */
  action: "review" | "look_through";
  recorded: boolean;
  prompt: string;
}

/** A ledger holder key used as a name ("name:Jane Doe") shown without its prefix. */
export function displayHolderName(name: string): string {
  return String(name ?? "").startsWith("name:") ? String(name).slice("name:".length) : String(name ?? "");
}

/** The statutory threshold: 25% of issued shares, or of the votes at general meetings (s. 119.11 (1)). */
export const SIGNIFICANT_SHARE_PERCENT = 25;

/**
 * Suggest holders who meet the s. 119.11 (1) share threshold on the register:
 * 25% or more of ALL issued shares by number (every class, voting or not), or
 * shares carrying 25% or more of the votes. These are candidates for review,
 * not determinations: beneficial ownership, indirect control, joint and
 * associated holdings and director-control rights are not visible in the
 * register and must be checked separately. A holder that is not an individual
 * is a prompt to look through to the individuals who own or control it.
 */
export function candidateSignificantIndividuals(
  holders: readonly CandidateHolderInput[],
  facts: Readonly<Record<string, CandidateHolderFacts>> = {},
  thresholdPercent = SIGNIFICANT_SHARE_PERCENT,
): SignificantIndividualCandidate[] {
  let totalShares = 0;
  let totalVotes = 0;
  for (const holder of holders) {
    totalShares += Math.max(0, Number(holder.totalShares) || 0);
    totalVotes += Math.max(0, Number(holder.totalVotes) || 0);
  }
  const candidates: SignificantIndividualCandidate[] = [];
  for (const holder of holders) {
    const shares = Math.max(0, Number(holder.totalShares) || 0);
    const votes = Math.max(0, Number(holder.totalVotes) || 0);
    const bases: CandidateBasis[] = [];
    // Compare as products so 25 of 100 shares is exactly 25%, with no float drift.
    if (totalShares > 0 && shares * 100 >= thresholdPercent * totalShares) bases.push("issued_shares_25");
    if (totalVotes > 0 && votes * 100 >= thresholdPercent * totalVotes) bases.push("votes_25");
    if (!bases.length) continue;
    const fact = facts[holder.holderKey] ?? {};
    const holderName = displayHolderName(holder.holderName);
    const holderType = fact.isIndividual === false ? "non_individual" : "individual";
    const recorded = fact.recorded === true;
    const measure = bases.map((basis) => (basis === "issued_shares_25" ? `${thresholdPercent}% or more of all issued shares` : `shares carrying ${thresholdPercent}% or more of the votes`)).join(" and ");
    candidates.push({
      holderKey: holder.holderKey,
      holderName,
      totalShares: shares,
      totalVotes: votes,
      percentOfShares: totalShares > 0 ? (shares / totalShares) * 100 : 0,
      percentOfVotes: totalVotes > 0 ? (votes / totalVotes) * 100 : 0,
      bases,
      holderType,
      action: holderType === "non_individual" ? "look_through" : "review",
      recorded,
      prompt: holderType === "non_individual"
        ? `${holderName} holds ${measure}. It is not an individual: identify the individuals who own or control it, directly or indirectly, and assess each of them.`
        : recorded
          ? `${holderName} holds ${measure} and is already on the register. Confirm the recorded basis and dates are current.`
          : `${holderName} holds ${measure}. Review whether this individual is a significant individual and, if so, record them.`,
    });
  }
  return candidates.sort((a, b) => b.percentOfShares - a.percentOfShares || b.percentOfVotes - a.percentOfVotes || a.holderName.localeCompare(b.holderName));
}

// ---------------------------------------------------------------------------
// Transparency-register deadlines (BC Business Corporations Act Part 4.1).
//
// Verified against the consolidation current to October 6, 2026:
//   s. 119.3      annual review in the period from the recognition anniversary
//                 to 2 months after it;
//   s. 119.31 (1) record new or different information within 30 days after
//                 becoming aware of it;
//   s. 119.31 (2) record unobtainable-information steps within that 2-month period;
//   s. 119.41     notify the individual within 10 days after the register shows
//                 they became, or ceased to be, significant;
//   s. 119.4      delete the information within one year after the sixth
//                 anniversary of the cessation entry.
// ---------------------------------------------------------------------------

export const TRANSPARENCY_UPDATE_DAYS = 30;
export const TRANSPARENCY_NOTICE_DAYS = 10;
export const TRANSPARENCY_REVIEW_MONTHS = 2;

/** Kinds of diligence-step entries; a step without a kind is a plain note. */
export type TransparencyStepKind = "annual_review" | "change" | "became_significant" | "ceased_significant" | "information_request" | "other";
export const TRANSPARENCY_STEP_KINDS: ReadonlyArray<{ value: TransparencyStepKind; label: string }> = [
  { value: "annual_review", label: "Annual review" },
  { value: "change", label: "New or changed information" },
  { value: "became_significant", label: "Became a significant individual" },
  { value: "ceased_significant", label: "Ceased to be a significant individual" },
  { value: "information_request", label: "Request for information" },
  { value: "other", label: "Other step" },
];

export interface TransparencyEventInput {
  id?: string;
  individualName: string;
  stepKind?: string;
  stepDate?: string;
  /** The day the company became aware of the new or different information. */
  awareOn?: string;
  /** The day it was recorded in the register (for became/ceased, the register entry). */
  recordedOn?: string;
  /** The day notice was sent to the individual (became/ceased only). */
  notifiedOn?: string;
}

export interface TransparencyDeadline {
  key: string;
  title: string;
  dueDate: string;
  basis: string;
  status: "upcoming" | "due" | "overdue";
  cycleYear: number;
  /** Earliest day the action can be taken (the annual review window opens on the anniversary). */
  opensOn?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
function plusDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function inYearClamped(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
function plusMonths(value: string, months: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const ordinal = y * 12 + (m - 1) + months;
  return inYearClamped(Math.floor(ordinal / 12), (ordinal % 12) + 1, d);
}
function statusFor(dueDate: string, today: string): TransparencyDeadline["status"] {
  return dueDate < today ? "overdue" : dueDate === today ? "due" : "upcoming";
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "individual";
}

/** A missed window this many days past its end is history, not the open review. */
const REVIEW_GRACE_DAYS = 7;

/**
 * The open annual-review window (s. 119.3): the first window, from the first
 * recognition anniversary on, that ends no earlier than a week before today and
 * has no recorded annual review inside it.
 */
export function openTransparencyReview(recognitionDate: string | undefined, reviewDates: readonly string[], today: string): TransparencyDeadline | null {
  if (!validDay(recognitionDate) || !validDay(today)) return null;
  const [ry, rm, rd] = recognitionDate.split("-").map(Number);
  const floor = plusDays(today, -REVIEW_GRACE_DAYS);
  const firstYear = Math.max(ry + 1, Number(today.slice(0, 4)) - 1);
  for (let year = firstYear; year <= Number(today.slice(0, 4)) + 1; year++) {
    const opensOn = inYearClamped(year, rm, rd);
    const dueDate = plusMonths(opensOn, TRANSPARENCY_REVIEW_MONTHS);
    if (dueDate < floor) continue;
    if (reviewDates.some((date) => validDay(date) && date >= opensOn && date <= dueDate)) continue;
    return {
      key: "transparency-review",
      title: "Transparency register annual review",
      dueDate,
      opensOn,
      cycleYear: year,
      status: statusFor(dueDate, today),
      basis: `Business Corporations Act s. 119.3: between ${opensOn} (the recognition anniversary) and ${dueDate}, take reasonable steps to confirm the transparency register is accurate, complete and up to date. Record any information you could not obtain or confirm, with the steps taken, within the same period (s. 119.31 (2)). Applies to private companies; check whether an exclusion applies.`,
    };
  }
  return null;
}

/**
 * Deadlines from recorded transparency events: recording new information
 * (30 days, s. 119.31 (1)), notifying the individual (10 days, s. 119.41), and
 * disposal of a former individual's information once that window opens (s. 119.4).
 */
export function transparencyEventDeadlines(events: readonly TransparencyEventInput[], today: string): TransparencyDeadline[] {
  if (!validDay(today)) return [];
  const deadlines: TransparencyDeadline[] = [];
  for (const event of events) {
    const name = String(event.individualName ?? "").trim() || "an individual";
    const id = event.id ?? `${slug(name)}-${event.awareOn ?? event.recordedOn ?? event.stepDate ?? ""}`;
    const notifiable = event.stepKind === "became_significant" || event.stepKind === "ceased_significant";
    if (validDay(event.awareOn) && !validDay(event.recordedOn) && event.stepKind !== "annual_review") {
      const dueDate = plusDays(event.awareOn, TRANSPARENCY_UPDATE_DAYS);
      deadlines.push({
        key: `transparency-update:${id}`,
        title: `Record transparency register change: ${name}`,
        dueDate,
        cycleYear: Number(dueDate.slice(0, 4)),
        status: statusFor(dueDate, today),
        basis: `Business Corporations Act s. 119.31 (1): record new or different register information within ${TRANSPARENCY_UPDATE_DAYS} days after the company became aware of it (aware on ${event.awareOn}).`,
      });
    }
    if (notifiable && validDay(event.recordedOn) && !validDay(event.notifiedOn)) {
      const dueDate = plusDays(event.recordedOn, TRANSPARENCY_NOTICE_DAYS);
      const what = event.stepKind === "became_significant" ? "is" : "has ceased to be";
      deadlines.push({
        key: `transparency-notice:${id}`,
        title: `Notify ${name} of transparency register entry`,
        dueDate,
        cycleYear: Number(dueDate.slice(0, 4)),
        status: statusFor(dueDate, today),
        basis: `Business Corporations Act s. 119.41: within ${TRANSPARENCY_NOTICE_DAYS} days after the register shows that ${name} ${what} a significant individual (entry on ${event.recordedOn}), send them a notice of that fact.`,
      });
    }
    if (event.stepKind === "ceased_significant" && validDay(event.recordedOn)) {
      const window = transparencyDisposalWindow(event.recordedOn)!;
      if (today >= window.opensOn) {
        deadlines.push({
          key: `transparency-disposal:${id}`,
          title: `Delete transparency information: ${name}`,
          dueDate: window.dueBy,
          opensOn: window.opensOn,
          cycleYear: Number(window.dueBy.slice(0, 4)),
          status: statusFor(window.dueBy, today),
          basis: `Business Corporations Act s. 119.4: within one year after the sixth anniversary (${window.opensOn}) of the entry showing ${name} ceased to be significant, delete their information from the register and destroy the related records, unless another law requires them to be kept.`,
        });
      }
    }
  }
  return deadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
}

/** Map stored significantIndividualSteps rows to the pure deadline inputs. */
export function transparencyEventsFromSteps(rows: readonly Record<string, any>[]): TransparencyEventInput[] {
  return rows.map((row) => ({
    id: String(row._id ?? ""),
    individualName: String(row.individualName ?? ""),
    stepKind: row.stepKind,
    stepDate: row.stepDate,
    awareOn: row.awareOn,
    recordedOn: row.recordedOn,
    notifiedOn: row.notifiedOn,
  }));
}

/** Annual review plus event deadlines for a BC private company's register. */
export function deriveTransparencyDeadlines(
  input: { recognitionDate?: string; events?: readonly TransparencyEventInput[] },
  today: string,
): TransparencyDeadline[] {
  const events = input.events ?? [];
  const reviewDates = events.filter((event) => event.stepKind === "annual_review").map((event) => String(event.stepDate ?? ""));
  const review = openTransparencyReview(input.recognitionDate, reviewDates, today);
  return [...(review ? [review] : []), ...transparencyEventDeadlines(events, today)];
}

function nameKey(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Holder facts for candidateSignificantIndividuals from the role-holder
 * register: a linked holder's recorded non-individual flag (else the name
 * heuristic), and whether a current controller already covers the holder (the
 * holder row itself, or a controller with the same name).
 */
export function candidateFactsFromRegister(
  holders: readonly CandidateHolderInput[],
  roleHolders: readonly Record<string, any>[],
  isOrganizationName: (name: string) => boolean,
): Record<string, CandidateHolderFacts> {
  const byId = new Map(roleHolders.map((row) => [String(row._id), row]));
  const controllerNames = new Set(
    roleHolders
      .filter((row) => row.roleType === "controller" && row.status !== "former" && !row.endDate)
      .map((row) => nameKey(row.fullName)),
  );
  const facts: Record<string, CandidateHolderFacts> = {};
  for (const holder of holders) {
    const linked = holder.holderKey.startsWith("roleHolder:") ? byId.get(holder.holderKey.slice("roleHolder:".length)) : undefined;
    const name = String(linked?.fullName ?? displayHolderName(holder.holderName));
    const isIndividual = linked?.nonNaturalPerson === true ? false
      : linked?.nonNaturalPerson === false ? true
        : isOrganizationName(name) ? false : undefined;
    facts[holder.holderKey] = {
      ...(isIndividual !== undefined ? { isIndividual } : {}),
      recorded: linked?.roleType === "controller" || controllerNames.has(nameKey(name)),
    };
  }
  return facts;
}

/** Reminders that the register alone cannot answer (shown with the candidates). */
export const CANDIDATE_REVIEW_REMINDERS: readonly string[] = [
  "Candidates come from registered holdings only. They are suggestions to review, not a finding that anyone is or is not a significant individual.",
  "Also consider beneficial owners, indirect control, interests held jointly, and holdings that together reach the threshold under an agreement to act together or between associates (s. 119.11 (2) to (4)).",
  "Also consider anyone who can elect, appoint or remove a majority of the directors, or who has direct and significant influence over someone who can (s. 119.11 (2) (b)).",
];

/**
 * BC legal-question field metadata for the significant-individual disclosure,
 * usable directly as form labels/help text.
 */
export const SIGNIFICANT_INDIVIDUAL_FIELDS: ReadonlyArray<{
  key: string;
  label: string;
  help: string;
  required: boolean;
}> = [
  {
    key: "name",
    label: "Full legal name",
    help: "The full legal name of the significant individual.",
    required: true,
  },
  {
    key: "address",
    label: "Address",
    help: "The latest known mailing or delivery address of the individual.",
    required: false,
  },
  {
    key: "dateOfBirth",
    label: "Date of birth",
    help: "The individual's date of birth (ISO YYYY-MM-DD).",
    required: false,
  },
  {
    key: "citizenship",
    label: "Citizenship",
    help: "Every country of which the individual is a citizen.",
    required: false,
  },
  {
    key: "taxResidentHomeJurisdiction",
    label: "Tax resident in the home jurisdiction",
    help: "Whether the individual is a tax resident of the corporation's home jurisdiction (yes / no / unknown).",
    required: true,
  },
  {
    key: "becameSignificantOn",
    label: "Date the individual became significant",
    help: "The date the individual most recently became a significant individual (ISO YYYY-MM-DD).",
    required: true,
  },
  {
    key: "ceasedSignificantOn",
    label: "Date the individual ceased to be significant",
    help: "The date the individual ceased to be a significant individual, if applicable (ISO YYYY-MM-DD).",
    required: false,
  },
  {
    key: "reason",
    label: "Reason for significance",
    help: "How the individual meets the test for being a significant individual (e.g. ownership, control, or influence).",
    required: true,
  },
];
