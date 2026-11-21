/**
 * Director consent to act, read from the consent register (`directorConsents`,
 * shared/businessEvidence.ts). The register keeps every version: a revision
 * points at the row it replaces through `previousId`.
 *
 * A director's consent *evidence state* is derived here from the register:
 * which "Consent to act" entry is in effect today (effective dates in the
 * future are scheduled, not current), what happened (Given / Corrected /
 * Withdrawn), and whether someone has reviewed the recorded basis. Only a
 * reviewed, current, given consent on a basis the governing Act accepts is
 * `verified`, and only `verified` satisfies the consent requirement. Recording
 * a historical appointment is not the same as asserting its basis was checked.
 *
 * `directors.consentOnFile` is a cache of `verified` kept by the register's
 * write path. A director flagged before the register existed (flag set, no
 * register entry) is `legacy_flag_only`: the details still need recording.
 *
 * Used by the business-evidence write path, the dashboard and continuity
 * consent checks, the Directors page and the director drawer. Framework-free.
 */
import { legalGovernanceProfile, type GovernanceOrganization } from "./legalGovernanceProfiles";
import { organizationTimeZone, type LegalEntityLike } from "./organizationDomain";
import { todayDateOnly } from "./dateOnly";

export const CONSENT_TO_ACT_SCOPE = "Consent to act";

export type DirectorConsentEvent = "Given" | "Withdrawn" | "Corrected";

/** The register's basis values (schema: convex/tables/businessEvidence.ts). */
export type DirectorConsentBasis = "Written consent" | "Meeting record" | "Conduct" | "Other";

/** The register's evidence review values. */
export const CONSENT_REVIEW_STATUSES = ["Awaiting review", "Reviewed", "Disputed"] as const;
export type DirectorConsentReviewStatus = (typeof CONSENT_REVIEW_STATUSES)[number];

export interface DirectorConsentRow {
  _id: string;
  directorId?: string;
  scope?: string;
  event?: string;
  effectiveDate?: string;
  basis?: string;
  signedOn?: string;
  receivedOn?: string;
  documentDate?: string;
  reviewStatus?: string;
  meetingId?: string;
  evidenceLocation?: string;
  evidenceReference?: string;
  custodian?: string;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
  recordedAt?: string;
  previousId?: string;
  documentId?: string;
  documentMissing?: boolean;
}

/**
 * - `none`: no basis recorded (outstanding requirement)
 * - `awaiting_review`: a basis is recorded but not yet reviewed (outstanding verification)
 * - `verified`: a current basis whose evidence was reviewed (satisfied)
 * - `disputed`: the review disputed the recorded basis (outstanding review)
 * - `scheduled`: the only entries take effect after today (not current yet)
 * - `withdrawn`: the current entry withdraws consent (reassessment required)
 * - `legacy_flag_only`: the pre-register "on file" flag with no register entry (details need recording)
 */
export type DirectorConsentState = "none" | "awaiting_review" | "verified" | "disputed" | "scheduled" | "withdrawn" | "legacy_flag_only";

export const DIRECTOR_CONSENT_STATES: readonly DirectorConsentState[] = ["none", "awaiting_review", "verified", "disputed", "scheduled", "withdrawn", "legacy_flag_only"];

export interface DirectorConsentAssessment<Row extends DirectorConsentRow = DirectorConsentRow> {
  state: DirectorConsentState;
  /** The entry in effect today (latest effective date on or before today). */
  current?: Row;
  /** The next entry to take effect after today, if any. */
  upcoming?: Row;
  /** A reviewed entry whose basis the governing Act doesn't accept; it stays awaiting review. */
  basisNotAccepted?: boolean;
}

/** Only a verified consent satisfies the requirement. */
export function consentStateSatisfied(state: DirectorConsentState | undefined): boolean {
  return state === "verified";
}

function bySupersession<Row extends DirectorConsentRow>(rows: readonly Row[], directorId: string): Row[] {
  const superseded = new Set(rows.map((row) => row.previousId).filter((id): id is string => Boolean(id)).map(String));
  return rows.filter((row) => String(row.directorId ?? "") === directorId && row.scope === CONSENT_TO_ACT_SCOPE && !superseded.has(String(row._id)));
}

function newestFirst<Row extends DirectorConsentRow>(a: Row, b: Row) {
  return String(b.effectiveDate ?? "").localeCompare(String(a.effectiveDate ?? ""))
    || String(b.recordedAt ?? "").localeCompare(String(a.recordedAt ?? ""));
}

/**
 * The director's latest "Consent to act" entry regardless of date: superseded
 * versions are skipped, then the latest effective date wins, then the latest
 * recording.
 */
export function latestConsentToAct<Row extends DirectorConsentRow>(rows: readonly Row[], directorId: string): Row | undefined {
  return bySupersession(rows, directorId).sort(newestFirst)[0];
}

/**
 * The director's consent evidence state on `today` (a `YYYY-MM-DD` in the
 * organization's calendar; see `consentToday`). `acceptedBases` limits which
 * reviewed bases count as verified (see `acceptedConsentBases`); omit it to
 * accept any recorded basis.
 */
export function assessDirectorConsent<Row extends DirectorConsentRow>(
  rows: readonly Row[],
  director: { _id: string; consentOnFile?: boolean },
  options: { today: string; acceptedBases?: readonly string[] },
): DirectorConsentAssessment<Row> {
  const entries = bySupersession(rows, String(director._id)).sort(newestFirst);
  if (!entries.length) return { state: director.consentOnFile ? "legacy_flag_only" : "none" };
  const current = entries.find((row) => String(row.effectiveDate ?? "") <= options.today);
  const upcoming = entries.filter((row) => String(row.effectiveDate ?? "") > options.today).at(-1);
  const extra = upcoming ? { upcoming } : {};
  if (!current) return { state: "scheduled", ...extra };
  if (current.event === "Withdrawn") return { state: "withdrawn", current, ...extra };
  if (current.reviewStatus === "Disputed") return { state: "disputed", current, ...extra };
  if (current.reviewStatus === "Reviewed") {
    const basisAccepted = !options.acceptedBases || (current.basis !== undefined && options.acceptedBases.includes(current.basis));
    if (basisAccepted) return { state: "verified", current, ...extra };
    return { state: "awaiting_review", current, basisNotAccepted: true, ...extra };
  }
  return { state: "awaiting_review", current, ...extra };
}

/**
 * Today's date in the organization's own calendar (its recorded time zone or
 * home province), so an entry effective "today" in Vancouver is current there
 * even when the server's UTC day has moved on. Falls back to the runtime's
 * local day when no zone is known.
 */
export function consentToday(organization?: (LegalEntityLike & { timeZone?: string | null }) | null, now: Date = new Date()): string {
  const zone = organizationTimeZone(organization);
  if (!zone) return todayDateOnly(now);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return todayDateOnly(now);
  }
}

export interface ConsentBasisOption {
  value: DirectorConsentBasis;
  /** What the basis means under this organization's governing Act. */
  label: string;
  /** What to record as evidence for it. */
  evidence: string;
}

const WRITTEN = (label: string): ConsentBasisOption => ({ value: "Written consent", label, evidence: "The signed consent: link the document, or say where it is held." });
const MEETING = (label: string): ConsentBasisOption => ({ value: "Meeting record", label, evidence: "The meeting and the minutes or attendance record showing presence without refusal." });
const CONDUCT = (label: string): ConsentBasisOption => ({ value: "Conduct", label, evidence: "A record of the director acting in office, such as a signed resolution or minutes." });

/**
 * The consent bases the organization's governing Act accepts:
 * - BC society, Societies Act s.42(4): written consent, or present at the
 *   meeting where elected or appointed and did not refuse.
 * - BC company, Business Corporations Act s.123: written consent, present at
 *   the meeting and did not refuse, or acting as a director (qualifying conduct).
 * - CBCA s.106(9): present at the meeting without refusing; if absent, written
 *   consent before or within ten days, or acting under the appointment.
 * - OBCA s.119(9): written consent.
 * Organizations without a reviewed profile get every basis, including Other.
 */
export function consentBasisOptions(organization?: GovernanceOrganization | null): ConsentBasisOption[] {
  switch (legalGovernanceProfile(organization)?.id) {
    case "bc_society":
      return [WRITTEN("Consented in writing"), MEETING("Present at the meeting and did not refuse")];
    case "bc_company":
      return [WRITTEN("Consented in writing"), MEETING("Present at the meeting and did not refuse"), CONDUCT("Acted as a director after the appointment")];
    case "federal_cbca":
      return [MEETING("Present at the meeting and did not refuse"), WRITTEN("Consented in writing before or within ten days"), CONDUCT("Acted as a director under the appointment")];
    case "ontario_obca":
      return [WRITTEN("Consented in writing")];
    default:
      return [WRITTEN("Written consent"), MEETING("Meeting record"), CONDUCT("Acting as a director"), { value: "Other", label: "Other", evidence: "Describe the basis and where its evidence is held." }];
  }
}

/** The basis values that can be verified for this organization. */
export function acceptedConsentBases(organization?: GovernanceOrganization | null): DirectorConsentBasis[] {
  return consentBasisOptions(organization).map((option) => option.value);
}

/**
 * Why an entry can't be marked reviewed yet, or undefined when it can. A
 * reviewed consent needs a basis the Act accepts and something pointing at its
 * evidence: a document, the meeting, or where the evidence is held.
 */
export function consentReviewProblem(
  entry: Pick<DirectorConsentRow, "event" | "basis" | "documentId" | "meetingId" | "evidenceLocation" | "evidenceReference">,
  organization?: GovernanceOrganization | null,
): string | undefined {
  if (entry.event === "Withdrawn") return undefined;
  if (!entry.basis) return "Record the consent basis before marking it reviewed.";
  if (!acceptedConsentBases(organization).includes(entry.basis as DirectorConsentBasis)) return "This basis isn't one the governing Act accepts for consent to act. Correct the basis before marking it reviewed.";
  if (entry.basis === "Meeting record" && !entry.meetingId && !entry.evidenceReference) return "Choose the meeting, or give the meeting record's reference, before marking it reviewed.";
  if (!entry.documentId && !entry.meetingId && !entry.evidenceLocation && !entry.evidenceReference) return "Link the evidence or say where it is held before marking it reviewed.";
  return undefined;
}

export const CONSENT_STATE_LABELS: Record<DirectorConsentState, string> = {
  none: "No basis recorded",
  awaiting_review: "Awaiting review",
  verified: "Verified",
  disputed: "Disputed",
  scheduled: "Not yet in effect",
  withdrawn: "Withdrawn",
  legacy_flag_only: "Marked on file only",
};

/** How each unverified state reads in a count ("1 awaiting review"). */
const UNVERIFIED_PHRASES: Record<Exclude<DirectorConsentState, "verified">, string> = {
  none: "with no basis recorded",
  awaiting_review: "awaiting review",
  disputed: "disputed",
  scheduled: "not yet in effect",
  withdrawn: "withdrawn",
  legacy_flag_only: "marked on file without details",
};

/** "1 awaiting review, 1 with no basis recorded" for the unverified states given. */
export function describeUnverifiedConsents(states: readonly (DirectorConsentState | undefined)[]): string {
  const counts = new Map<Exclude<DirectorConsentState, "verified">, number>();
  for (const state of states) {
    const key = (state ?? "none") as DirectorConsentState;
    if (key === "verified") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return DIRECTOR_CONSENT_STATES
    .filter((state): state is Exclude<DirectorConsentState, "verified"> => state !== "verified" && counts.has(state as Exclude<DirectorConsentState, "verified">))
    .map((state) => `${counts.get(state)} ${UNVERIFIED_PHRASES[state]}`)
    .join(", ");
}

/**
 * "2 active directors' consent basis has not been verified (1 awaiting review,
 * 1 with no basis recorded)." Undefined when every state is verified.
 */
export function unverifiedConsentSentence(states: readonly (DirectorConsentState | undefined)[], noun = "active"): string | undefined {
  const unverified = states.filter((state) => state !== "verified");
  if (!unverified.length) return undefined;
  const subject = unverified.length === 1 ? `1 ${noun} director's` : `${unverified.length} ${noun} directors'`;
  return `${subject} consent basis has not been verified (${describeUnverifiedConsents(unverified)}).`;
}
