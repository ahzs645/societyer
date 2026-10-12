/**
 * REGISTER VALIDATION — required-field and consistency checks for the
 * director and member registers (ui-governance G-07).
 *
 * Blank rows used to be saved as "Open director" / "Open member" and counted
 * toward statutory figures (active directors, BC-resident directors, voting
 * members, election eligibility). These checks run inside the portable
 * create/update mutations so every runtime enforces them, and the editors use
 * the same functions for inline messages.
 */

import { looksLikeOrganization } from "./nlg";
import { legalGovernanceProfile } from "./legalGovernanceProfiles";
import { isCorporation, type LegalEntityLike } from "./organizationDomain";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function isPlausibleEmail(value: unknown): boolean {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type DirectorLike = {
  firstName?: string;
  lastName?: string;
  email?: string;
  position?: string;
  termStart?: string;
  termEnd?: string;
  resignedAt?: string;
  status?: string;
};

export function directorProblems(row: DirectorLike): string[] {
  const problems: string[] = [];
  if (!text(row.firstName) && !text(row.lastName)) problems.push("Enter the director's name.");
  if (row.position !== undefined && !text(row.position)) problems.push("Choose the director's position.");
  if (text(row.email) && !isPlausibleEmail(row.email)) problems.push(`"${text(row.email)}" is not a valid email address.`);
  if (text(row.termStart) && !isCalendarDate(text(row.termStart))) problems.push("Term start must be a valid date.");
  if (text(row.termEnd) && !isCalendarDate(text(row.termEnd))) problems.push("Term end must be a valid date.");
  if (isCalendarDate(text(row.termStart)) && isCalendarDate(text(row.termEnd)) && text(row.termEnd) < text(row.termStart)) {
    problems.push("Term end cannot be before term start.");
  }
  if (text(row.resignedAt) && isCalendarDate(text(row.termStart)) && text(row.resignedAt).slice(0, 10) < text(row.termStart)) {
    problems.push("Resignation date cannot be before term start.");
  }
  return problems;
}

/** A director whose term end has passed but who is still marked Active. */
export function directorTermLapsed(row: DirectorLike, today: string): boolean {
  return row.status === "Active" && isCalendarDate(text(row.termEnd)) && text(row.termEnd) < today;
}

export type MemberLike = {
  firstName?: string;
  lastName?: string;
  email?: string;
  membershipClass?: string;
  status?: string;
  joinedAt?: string;
  leftAt?: string;
};

export function memberProblems(row: MemberLike): string[] {
  const problems: string[] = [];
  if (!text(row.firstName) && !text(row.lastName)) problems.push("Enter the member's name.");
  if (row.membershipClass !== undefined && !text(row.membershipClass)) problems.push("Choose a membership class.");
  if (text(row.email) && !isPlausibleEmail(row.email)) problems.push(`"${text(row.email)}" is not a valid email address.`);
  if (text(row.joinedAt) && !isCalendarDate(text(row.joinedAt))) problems.push("Joined date must be a valid date.");
  if (text(row.leftAt) && !isCalendarDate(text(row.leftAt))) problems.push("Left date must be a valid date.");
  if (isCalendarDate(text(row.joinedAt)) && isCalendarDate(text(row.leftAt)) && text(row.leftAt) < text(row.joinedAt)) {
    problems.push("Left date cannot be before the joined date.");
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Director and officer eligibility (corporations only; societies keep the
// Societies Act rules applied elsewhere).
//
// BC Business Corporations Act, verified against the consolidation current to
// October 6, 2026:
//   s. 124 (1)  a person must not become or act as a director unless that
//               person is an individual who is qualified to do so;
//   s. 124 (2)  not qualified: (a) under 18; (b) found by a court to be
//               incapable of managing their own affairs; (b.1) subject to an
//               Adult Guardianship Act certificate of incapability; (c) an
//               undischarged bankrupt; (d) certain convictions (fraud, or
//               corporate promotion/formation/management) unless a court
//               orders otherwise, 5 years have passed, or a pardon or record
//               suspension applies;
//   s. 124 (3)  a director who ceases to be qualified must promptly resign;
//   s. 141 (3)  an individual not qualified under s. 124 to be a director is
//               not qualified to be an officer.
// Only the individual and age tests use recorded data; (b) to (d) are a review
// prompt because Societyer holds no data for them.
// ---------------------------------------------------------------------------


export type EligibilityScope = "bc_company" | "other_corporation" | "not_corporation";

/** Which director/officer eligibility rules apply to an organization. */
export function eligibilityScopeFor(organization?: LegalEntityLike | null): EligibilityScope {
  if (!organization || !isCorporation(organization)) return "not_corporation";
  return legalGovernanceProfile(organization)?.id === "bc_company" ? "bc_company" : "other_corporation";
}

export interface RoleEligibilityInput {
  roleType?: string;
  status?: string;
  fullName?: string;
  nonNaturalPerson?: boolean;
  ageOver18?: boolean;
  dateOfBirth?: string;
  startDate?: string;
  officerTitle?: string;
  additionalOfficerTitles?: readonly string[];
}

export interface EligibilityResult {
  /** Save is refused (BC company: a non-individual director, or an under-18 director/officer). */
  blocking: string[];
  /** Shown for review; never blocks. */
  warnings: string[];
  /** Standing review prompts (facts Societyer does not hold). */
  notes: string[];
}

/** Whole years of age on a day, or null when either date is not a calendar date. */
export function ageOn(dateOfBirth: unknown, onDay: unknown): number | null {
  if (!isCalendarDate(dateOfBirth) || !isCalendarDate(onDay)) return null;
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [y, m, d] = onDay.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const FORMER = new Set(["former", "resigned", "removed", "inactive"]);

export const BC_DIRECTOR_OTHER_DISQUALIFICATIONS =
  "Also confirm the individual is not disqualified under Business Corporations Act s. 124 (2) (b) to (d): found by a court to be incapable of managing their own affairs, subject to a certificate of incapability under the Adult Guardianship Act, an undischarged bankrupt, or convicted of an offence involving fraud or connected with promoting, forming or managing a corporation or business (unless a court orders otherwise, 5 years have passed, or a pardon or record suspension applies).";

/**
 * Eligibility checks for one director or officer role-holder row. BC rules
 * apply only to a BC company; other corporations get the data-quality
 * warnings without BC citations; anything else gets nothing.
 */
export function roleHolderEligibility(row: RoleEligibilityInput, scope: EligibilityScope, today: string): EligibilityResult {
  const result: EligibilityResult = { blocking: [], warnings: [], notes: [] };
  if (scope === "not_corporation") return result;
  const roleType = text(row.roleType).toLowerCase();
  if (roleType !== "director" && roleType !== "officer") return result;
  const former = FORMER.has(text(row.status).toLowerCase());
  const label = roleType === "director" ? "director" : "officer";

  if (roleType === "officer" && !text(row.officerTitle) && !(row.additionalOfficerTitles ?? []).some((title) => text(title))) {
    result.warnings.push("This officer has no office recorded. Choose the office the directors appointed them to, such as President or Secretary.");
  }
  if (scope !== "bc_company") return result;

  const name = text(row.fullName);
  if (row.nonNaturalPerson === true) {
    if (roleType === "director") {
      if (!former) result.blocking.push("A BC company director must be an individual (Business Corporations Act s. 124 (1)). Record the individual who acts as director, not a corporation or other entity.");
      else result.warnings.push("This former director is recorded as a non-individual. A BC company director must be an individual (s. 124 (1)); check the record.");
    } else {
      result.warnings.push("This officer is recorded as a non-individual. Under Business Corporations Act s. 141 (2) (a), offices are held by individuals unless the articles provide otherwise; check the articles.");
    }
  } else if (row.nonNaturalPerson === undefined && name && looksLikeOrganization(name)) {
    result.warnings.push(`"${name}" looks like an organization. A BC company ${label} must be an individual (Business Corporations Act ${roleType === "director" ? "s. 124 (1)" : "ss. 124, 141"}).`);
  }

  const qualificationCite = roleType === "director" ? "s. 124 (2) (a)" : "ss. 124 (2) (a), 141 (3)";
  const asOf = former ? text(row.startDate) : today;
  const age = ageOn(row.dateOfBirth, asOf);
  const ageAtStart = ageOn(row.dateOfBirth, row.startDate);
  if (row.ageOver18 === false && !former) {
    result.blocking.push(`An individual under 18 is not qualified to be a BC company ${label} (Business Corporations Act ${qualificationCite}).`);
  } else if (age !== null && age < 18) {
    if (former) result.warnings.push(`This former ${label} was under 18 on the start date. An individual under 18 is not qualified to be a BC company ${label} (${qualificationCite}).`);
    else result.blocking.push(`${name || `This ${label}`} is under 18 according to the recorded date of birth. An individual under 18 is not qualified to be a BC company ${label} (Business Corporations Act ${qualificationCite}).`);
  } else if (!former && ageAtStart !== null && ageAtStart < 18) {
    result.warnings.push(`The recorded start date is before this ${label}'s 18th birthday. An appointment made while under 18 needs review (${qualificationCite}).`);
  }
  if (!former && !result.blocking.length) result.notes.push(roleType === "director" ? BC_DIRECTOR_OTHER_DISQUALIFICATIONS : `${BC_DIRECTOR_OTHER_DISQUALIFICATIONS} The same qualifications apply to officers (s. 141 (3)).`);
  return result;
}

/** Offices normally held by one person at a time; the rest may be shared. */
const SINGLE_OFFICES: Readonly<Record<string, string>> = {
  president: "President",
  secretary: "Secretary",
  treasurer: "Treasurer",
  secretary_treasurer: "Secretary-Treasurer",
  chief_executive_officer: "Chief Executive Officer",
  chief_financial_officer: "Chief Financial Officer",
  chief_operating_officer: "Chief Operating Officer",
  chair: "Chair",
  chairman: "Chair",
  chair_person: "Chair",
  chairwoman: "Chair",
};

function officeKey(title: unknown): string | null {
  const key = text(title).toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return null;
  return SINGLE_OFFICES[key] ? (SINGLE_OFFICES[key] === "Chair" ? "chair" : key) : null;
}

export interface OfficeHolderInput {
  id?: string;
  fullName?: string;
  roleType?: string;
  status?: string;
  officerTitle?: string;
  additionalOfficerTitles?: readonly string[];
  /** Directors register rows carry the office in `position`. */
  position?: string;
}

/**
 * Warnings when two current holders share an office normally held by one
 * person (two Presidents, two Secretaries). `allowShared` lists office keys the
 * articles or directors allow to be held jointly (e.g. ["chair"] for co-chairs).
 */
export function sharedOfficeWarnings(rows: readonly OfficeHolderInput[], options: { allowShared?: readonly string[] } = {}): string[] {
  const holders = new Map<string, Set<string>>();
  for (const row of rows) {
    if (FORMER.has(text(row.status).toLowerCase())) continue;
    const titles = [row.officerTitle, ...(row.additionalOfficerTitles ?? []), row.position];
    const name = text(row.fullName) || "Unnamed";
    for (const title of new Set(titles.map(officeKey).filter((key): key is string => Boolean(key)))) {
      if (options.allowShared?.includes(title)) continue;
      const set = holders.get(title) ?? new Set<string>();
      set.add(`${row.id ?? ""}\u0000${name}`);
      holders.set(title, set);
    }
  }
  const warnings: string[] = [];
  for (const [title, set] of holders) {
    if (set.size < 2) continue;
    const names = [...set].map((entry) => entry.split("\u0000")[1]);
    warnings.push(`${names.join(" and ")} are both recorded as ${SINGLE_OFFICES[title]}. That office is normally held by one person at a time. Check the articles and the directors' appointments, and end the earlier holder's term if it has changed hands.`);
  }
  return warnings;
}

export function assertValid(problems: string[], subject: string): void {
  if (problems.length) throw new Error(`${subject} not saved: ${problems.join(" ")}`);
}
