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

export function assertValid(problems: string[], subject: string): void {
  if (problems.length) throw new Error(`${subject} not saved: ${problems.join(" ")}`);
}
