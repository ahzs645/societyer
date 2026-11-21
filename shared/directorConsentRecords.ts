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
import { addDaysToDateOnly, todayDateOnly } from "./dateOnly";

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
  /** Who wrote this version (on a review version, the reviewer). */
  recordedBy?: string;
  /** On a review version: who recorded the particulars it reviews. */
  enteredBy?: string;
  /** Stamped by the server when the reviewer also recorded the particulars. */
  selfReviewed?: boolean;
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
  /** Why, when it's more specific than the basis itself (a CBCA consent signed too late). */
  basisNotAcceptedReason?: string;
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
 * accept any recorded basis. `writtenConsentWindowDays` (CBCA s.106(9)) keeps a
 * reviewed written consent signed later than that many days after the
 * appointment from counting. `consentAssessmentOptions` builds the options for
 * an organization.
 *
 * Re-election: the state reads the latest entry in effect, so a verified
 * consent keeps covering the director after a re-election until a later entry
 * withdraws or replaces it. The Acts differ on whether one consent carries
 * over: BCA s.123(3)(b) keeps it effective while the director is promptly
 * re-elected or re-appointed; OBCA s.119(11) needs no new consent on a
 * re-election with no break in term; CBCA s.106(9) and Societies Act s.42(4)
 * attach the consent route to each election or appointment, so nothing is
 * carried over. The director register keeps only the current term (`termStart`
 * is overwritten on re-election) and no appointment history, so the break
 * between terms isn't known and carry-over isn't checked here. Record a new
 * consent entry for each re-election under the CBCA or the Societies Act, and
 * after a break in term under the BCA or the OBCA.
 */
export function assessDirectorConsent<Row extends DirectorConsentRow>(
  rows: readonly Row[],
  director: { _id: string; consentOnFile?: boolean },
  options: ConsentAssessmentOptions,
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
    if (!basisAccepted) return { state: "awaiting_review", current, basisNotAccepted: true, ...extra };
    // A written consent reviewed before the ten-day rule was checked doesn't
    // count once its signed date shows it came too late.
    if (options.writtenConsentWindowDays !== undefined && writtenConsentTiming(current, options.writtenConsentWindowDays) === "late") {
      return { state: "awaiting_review", current, basisNotAccepted: true, basisNotAcceptedReason: CBCA_LATE_WRITTEN_CONSENT, ...extra };
    }
    return { state: "verified", current, ...extra };
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
  /** What the evidence must show. */
  evidence: string;
}

export interface ConsentAssessmentOptions {
  today: string;
  acceptedBases?: readonly string[];
  /** A reviewed written consent signed later than this many days after the appointment doesn't count. */
  writtenConsentWindowDays?: number;
}

/** CBCA s.106(9)(b)(i) and OBCA s.119(9): before, or within ten days after, the election or appointment. */
export const WRITTEN_CONSENT_WINDOW_DAYS = 10;

export const CBCA_LATE_WRITTEN_CONSENT = "Signed more than ten days after the appointment, which CBCA s.106(9) doesn't accept. If they have acted as a director, record that basis instead.";
export const CBCA_WRITTEN_CONSENT_NEEDS_DATE = "Record the date the consent was signed before marking it reviewed. CBCA s.106(9) accepts a written consent signed before, or within ten days after, the appointment.";
export const OBCA_LATE_WRITTEN_CONSENT_NOTE = "Signed after the ten-day window; s.119(10) still validates the appointment.";

const MEETING_LABEL = "At the meeting that elected or appointed them, and didn't refuse";
const MEETING_EVIDENCE = "The meeting, and the minutes or attendance record showing they were there and didn't refuse to act.";
const CONDUCT_EXAMPLES = "for example a resolution they signed, or minutes of a board meeting they took part in.";

interface ConsentActRules {
  options: ConsentBasisOption[];
  /** A written consent signed later than this many days after the appointment can't be verified. */
  writtenConsentWindowDays?: number;
  /** Shown, not enforced, when a written consent was signed after the ten-day window. */
  lateWrittenConsentNote?: string;
}

/**
 * The consent routes each governing Act accepts. Statute text checked
 * 2026-11-21, except the OBCA (see below).
 *
 * - BC society, Societies Act s.42(4): consents in writing, or attends the
 *   meeting at which designated, elected or appointed and doesn't refuse.
 * - BC company, Business Corporations Act:
 *   - s.123(1)(a): written consent, given before or after the designation,
 *     election or appointment;
 *   - s.123(1)(b): performing the functions of, or realizing benefits only
 *     available to, a director after the individual knew or ought to have
 *     known of the designation, election or appointment;
 *   - s.122(4)(b): an election or appointment of a succeeding director made at
 *     a meeting the individual attends without refusing, at the meeting, to be
 *     a director. Section 122(4) makes the election or appointment valid if (a)
 *     the individual consents under s.123 or (b) this meeting route (BC Laws
 *     text current to 2026-11-17). It doesn't reach a first director
 *     designated in the incorporation application (s.121).
 *   - s.123(2): once consent is given the appointment is valid, and the
 *     director is deemed one from its date. s.123(3): a consent stays
 *     effective until revoked, the term expires without the director being
 *     promptly re-elected or re-appointed, the director resigns, or is removed.
 * - CBCA s.106(9): not a director unless (a) present at the meeting when
 *   elected or appointed and didn't refuse; or (b) not present and (i)
 *   consented in writing before, or within ten days after, the election or
 *   appointment, or (ii) has acted as a director under it.
 * - OBCA s.119(9)–(11), from secondary sources: ontario.ca refused the fetch
 *   (HTTP 403), so the e-Laws text wasn't read. (9) written consent before, or
 *   within ten days after, the election or appointment; (10) a written consent
 *   after that period still makes the election or appointment valid; (11) (9)
 *   doesn't apply to a director re-elected or re-appointed with no break in
 *   term.
 *
 * Organizations without a reviewed profile get every basis, including Other.
 */
function consentActRules(organization?: GovernanceOrganization | null): ConsentActRules {
  switch (legalGovernanceProfile(organization)?.id) {
    case "bc_society":
      return { options: [
        { value: "Written consent", label: "Consented in writing", evidence: "The written consent they signed: link it, or say where it is held." },
        { value: "Meeting record", label: MEETING_LABEL, evidence: MEETING_EVIDENCE },
      ] };
    case "bc_company":
      return { options: [
        { value: "Written consent", label: "Consented in writing, before or after the appointment", evidence: "The written consent they signed. Any date counts, before or after the appointment." },
        { value: "Meeting record", label: MEETING_LABEL, evidence: `${MEETING_EVIDENCE} Not for a first director named in the incorporation application.` },
        { value: "Conduct", label: "Acted as a director after learning of the appointment", evidence: `A record of them acting as a director, or taking a benefit only directors get, after they knew of the appointment: ${CONDUCT_EXAMPLES}` },
      ] };
    case "federal_cbca":
      return {
        options: [
          { value: "Meeting record", label: MEETING_LABEL, evidence: MEETING_EVIDENCE },
          { value: "Written consent", label: "Consented in writing, no later than ten days after the appointment", evidence: "The written consent and the date they signed it: before the appointment, or within ten days after." },
          { value: "Conduct", label: "Not at the meeting, but acted as a director under the appointment", evidence: `A record of them acting as a director under this appointment: ${CONDUCT_EXAMPLES}` },
        ],
        writtenConsentWindowDays: WRITTEN_CONSENT_WINDOW_DAYS,
      };
    case "ontario_obca":
      return {
        options: [
          { value: "Written consent", label: "Consented in writing", evidence: "The written consent and the date they signed it. One signed more than ten days after the appointment still makes it valid." },
        ],
        lateWrittenConsentNote: OBCA_LATE_WRITTEN_CONSENT_NOTE,
      };
    default:
      return { options: [
        { value: "Written consent", label: "Written consent", evidence: "The signed consent: link the document, or say where it is held." },
        { value: "Meeting record", label: "Meeting record", evidence: "The meeting and the minutes or attendance record." },
        { value: "Conduct", label: "Acting as a director", evidence: "A record of the director acting in office, such as a signed resolution or minutes." },
        { value: "Other", label: "Other", evidence: "Describe the basis and where its evidence is held." },
      ] };
  }
}

/** The consent bases the organization's governing Act accepts, each with what its evidence must show. */
export function consentBasisOptions(organization?: GovernanceOrganization | null): ConsentBasisOption[] {
  return consentActRules(organization).options;
}

/** The basis values that can be verified for this organization. */
export function acceptedConsentBases(organization?: GovernanceOrganization | null): DirectorConsentBasis[] {
  return consentBasisOptions(organization).map((option) => option.value);
}

/** What `assessDirectorConsent` needs from the organization: its today and its Act's rules. */
export function consentAssessmentOptions(organization?: (GovernanceOrganization & { timeZone?: string | null }) | null, today?: string): ConsentAssessmentOptions {
  const rules = consentActRules(organization);
  return {
    today: today ?? consentToday(organization),
    acceptedBases: rules.options.map((option) => option.value),
    ...(rules.writtenConsentWindowDays !== undefined ? { writtenConsentWindowDays: rules.writtenConsentWindowDays } : {}),
  };
}

/**
 * When a written consent was signed relative to the appointment. The entry's
 * effective date is the appointment date: the record form defaults it to the
 * director's term start, and the generated consent form takes effect from it.
 * Undefined for other bases, or without an effective date.
 */
export function writtenConsentTiming(
  entry: Pick<DirectorConsentRow, "basis" | "signedOn" | "effectiveDate">,
  windowDays = WRITTEN_CONSENT_WINDOW_DAYS,
): "missing" | "on_time" | "late" | undefined {
  if (entry.basis !== "Written consent" || !entry.effectiveDate) return undefined;
  if (!entry.signedOn) return "missing";
  const deadline = addDaysToDateOnly(entry.effectiveDate, windowDays);
  if (!deadline) return undefined;
  return entry.signedOn > deadline ? "late" : "on_time";
}

/**
 * A note on when a written consent was signed, for the drawer: late under the
 * CBCA (not accepted), or late under the OBCA (still valid under s.119(10)).
 */
export function consentTimingNote(
  entry: Pick<DirectorConsentRow, "event" | "basis" | "signedOn" | "effectiveDate">,
  organization?: GovernanceOrganization | null,
): string | undefined {
  if (entry.event === "Withdrawn") return undefined;
  const rules = consentActRules(organization);
  if (rules.writtenConsentWindowDays !== undefined) return writtenConsentTiming(entry, rules.writtenConsentWindowDays) === "late" ? CBCA_LATE_WRITTEN_CONSENT : undefined;
  if (rules.lateWrittenConsentNote && writtenConsentTiming(entry) === "late") return rules.lateWrittenConsentNote;
  return undefined;
}

/**
 * Why an entry can't be marked reviewed yet, or undefined when it can. A
 * reviewed consent needs a basis the Act accepts and something pointing at its
 * evidence: a document, the meeting, or where the evidence is held. Under the
 * CBCA a written consent also needs its signed date, no later than ten days
 * after the appointment (the entry's effective date).
 */
export function consentReviewProblem(
  entry: Pick<DirectorConsentRow, "event" | "basis" | "documentId" | "meetingId" | "evidenceLocation" | "evidenceReference" | "signedOn" | "effectiveDate">,
  organization?: GovernanceOrganization | null,
): string | undefined {
  if (entry.event === "Withdrawn") return undefined;
  if (!entry.basis) return "Record the consent basis before marking it reviewed.";
  const rules = consentActRules(organization);
  if (!rules.options.some((option) => option.value === entry.basis)) return "This basis isn't one the governing Act accepts for consent to act. Correct the basis before marking it reviewed.";
  if (rules.writtenConsentWindowDays !== undefined) {
    const timing = writtenConsentTiming(entry, rules.writtenConsentWindowDays);
    if (timing === "missing") return CBCA_WRITTEN_CONSENT_NEEDS_DATE;
    if (timing === "late") return CBCA_LATE_WRITTEN_CONSENT;
  }
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
 * "Consent to act isn't verified for 2 active directors (1 awaiting review,
 * 1 with no basis recorded)." Undefined when every state is verified.
 */
export function unverifiedConsentSentence(states: readonly (DirectorConsentState | undefined)[], noun = "active"): string | undefined {
  const unverified = states.filter((state) => state !== "verified");
  if (!unverified.length) return undefined;
  const kinds = new Set(unverified.map((state) => state ?? "none"));
  // One kind needs no count: "(awaiting review)", not "(1 awaiting review)".
  const detail = kinds.size === 1
    ? UNVERIFIED_PHRASES[[...kinds][0] as Exclude<DirectorConsentState, "verified">]
    : describeUnverifiedConsents(unverified);
  const directors = `${unverified.length} ${noun} director${unverified.length === 1 ? "" : "s"}`;
  return `Consent to act isn't verified for ${directors} (${detail}).`;
}
