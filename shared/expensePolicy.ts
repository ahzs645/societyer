/**
 * Expense-claim policy (receipt, note and timeliness thresholds, and the
 * organisation's mileage rate), mileage claims, the soft duplicate check for
 * claims and invoices, and the approver-reminder rate limit. Shared by the
 * server handlers that enforce them and the screens that explain them. Pure
 * and dependency-free.
 */

export const CLAIM_POLICY_ENFORCEMENTS = ["warn", "block"] as const;
export type ClaimPolicyEnforcement = (typeof CLAIM_POLICY_ENFORCEMENTS)[number];

/** A threshold set to null is switched off. */
export type ExpenseClaimPolicy = {
  /** Claims of more than this need a receipt. */
  receiptOverCents: number | null;
  /** Claims of more than this need a note explaining the expense. */
  noteOverCents: number | null;
  /** Claims must be submitted within this many days of the expense. */
  maxAgeDays: number | null;
  /** "warn" flags the claim for approvers; "block" stops submission without an exception. */
  enforcement: ClaimPolicyEnforcement;
  /**
   * The rate the organisation reimburses per kilometre, in cents. Set by the
   * organisation (no official rate is assumed); mileage claims need one.
   */
  mileageRateCentsPerKm?: number | null;
};

/** No stored policy: every check is off. */
export const EMPTY_CLAIM_POLICY: ExpenseClaimPolicy = { receiptOverCents: null, noteOverCents: null, maxAgeDays: null, enforcement: "warn" };

/** Values offered when someone switches a check on for the first time. */
export const SUGGESTED_CLAIM_POLICY = { receiptOverCents: 7_500, noteOverCents: 50_000, maxAgeDays: 60 } as const;

export function normalizeClaimPolicy(row: Partial<ExpenseClaimPolicy> | null | undefined): ExpenseClaimPolicy {
  if (!row) return { ...EMPTY_CLAIM_POLICY };
  const amount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
  const days = typeof row.maxAgeDays === "number" && Number.isFinite(row.maxAgeDays) && row.maxAgeDays >= 1 ? Math.round(row.maxAgeDays) : null;
  const rate = typeof row.mileageRateCentsPerKm === "number" && Number.isFinite(row.mileageRateCentsPerKm) && row.mileageRateCentsPerKm > 0 ? Math.round(row.mileageRateCentsPerKm) : null;
  return {
    receiptOverCents: amount(row.receiptOverCents),
    noteOverCents: amount(row.noteOverCents),
    maxAgeDays: days,
    enforcement: row.enforcement === "block" ? "block" : "warn",
    mileageRateCentsPerKm: rate,
  };
}

export function claimPolicyIsActive(policy: ExpenseClaimPolicy): boolean {
  return policy.receiptOverCents !== null || policy.noteOverCents !== null || policy.maxAgeDays !== null;
}

/** Problems with a policy before it is saved. */
export function validateClaimPolicy(policy: ExpenseClaimPolicy): string[] {
  const errors: string[] = [];
  const amountOk = (value: number | null) => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000);
  if (!amountOk(policy.receiptOverCents)) errors.push("Enter a receipt threshold between $0 and $1,000,000.");
  if (!amountOk(policy.noteOverCents)) errors.push("Enter a note threshold between $0 and $1,000,000.");
  if (policy.maxAgeDays !== null && (!Number.isSafeInteger(policy.maxAgeDays) || policy.maxAgeDays < 1 || policy.maxAgeDays > 730)) {
    errors.push("Enter a submission window between 1 and 730 days.");
  }
  if (!CLAIM_POLICY_ENFORCEMENTS.includes(policy.enforcement)) errors.push("Choose whether the policy warns or blocks.");
  const rate = policy.mileageRateCentsPerKm ?? null;
  if (rate !== null && (!Number.isSafeInteger(rate) || rate < 1 || rate > MAX_MILEAGE_RATE_CENTS)) {
    errors.push("Enter a mileage rate between $0.01 and $5.00 per kilometre.");
  }
  return errors;
}

export type ClaimPolicyIssueCode = "receipt" | "note" | "age";
export type ClaimPolicyIssue = { code: ClaimPolicyIssueCode; message: string; short: string };

export type ClaimForPolicy = {
  /** "mileage" claims are paid at the mileage rate and need no receipt. */
  claimType?: string | null;
  amountCents: number;
  receiptDocumentId?: string | null;
  notes?: string | null;
  incurredAtISO?: string | null;
};

const dollars = (cents: number) => {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** Whole days from one YYYY-MM-DD date to another (negative when `to` is earlier). */
export function daysBetweenDates(from: string, to: string): number {
  const parse = (value: string) => {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** The policy checks a claim fails if it were submitted on `submittedOn` (YYYY-MM-DD). */
export function evaluateClaimPolicy(policy: ExpenseClaimPolicy, claim: ClaimForPolicy, submittedOn: string): ClaimPolicyIssue[] {
  const issues: ClaimPolicyIssue[] = [];
  const amount = Math.abs(Math.round(claim.amountCents || 0));
  if (policy.receiptOverCents !== null && amount > policy.receiptOverCents && !claim.receiptDocumentId && !isMileageClaim(claim)) {
    issues.push({ code: "receipt", short: "No receipt", message: `Claims over ${dollars(policy.receiptOverCents)} need a receipt.` });
  }
  if (policy.noteOverCents !== null && amount > policy.noteOverCents && !String(claim.notes ?? "").trim()) {
    issues.push({ code: "note", short: "No note", message: `Claims over ${dollars(policy.noteOverCents)} need a note explaining the expense.` });
  }
  if (policy.maxAgeDays !== null && claim.incurredAtISO && /^\d{4}-\d{2}-\d{2}/.test(claim.incurredAtISO)) {
    const age = daysBetweenDates(claim.incurredAtISO, submittedOn);
    if (age > policy.maxAgeDays) {
      issues.push({ code: "age", short: "Late", message: `Claims must be submitted within ${policy.maxAgeDays} days of the expense; this one is ${age} days old.` });
    }
  }
  return issues;
}

export const MIN_EXCEPTION_REASON_LENGTH = 5;

/**
 * What submitting does under the policy: allowed (maybe with warnings) or
 * blocked until the requester asks for an exception with a reason.
 */
export function claimSubmissionDecision(policy: ExpenseClaimPolicy, issues: readonly ClaimPolicyIssue[], exceptionReason?: string | null):
  | { allowed: true; flagged: boolean }
  | { allowed: false; reason: string } {
  if (!issues.length) return { allowed: true, flagged: false };
  const reason = String(exceptionReason ?? "").trim();
  if (policy.enforcement === "block" && reason.length < MIN_EXCEPTION_REASON_LENGTH) {
    return { allowed: false, reason: `${issues.map((issue) => issue.message).join(" ")} Fix the claim or request an exception with a reason.` };
  }
  return { allowed: true, flagged: true };
}

/** Sentence for the policy card and the activity log. */
export function describeClaimPolicy(policy: ExpenseClaimPolicy): string {
  const parts: string[] = [];
  if (policy.receiptOverCents !== null) parts.push(`receipt over ${dollars(policy.receiptOverCents)}`);
  if (policy.noteOverCents !== null) parts.push(`note over ${dollars(policy.noteOverCents)}`);
  if (policy.maxAgeDays !== null) parts.push(`submit within ${policy.maxAgeDays} days`);
  const mileage = policy.mileageRateCentsPerKm ? `mileage at ${formatMileageRate(policy.mileageRateCentsPerKm)}` : "";
  if (!parts.length) return mileage || "no claim policy";
  const checks = `${parts.join(", ")} (${policy.enforcement === "block" ? "blocks submission" : "warns approvers"})`;
  return mileage ? `${checks}; ${mileage}` : checks;
}

/* ---------------------------------------------------------------- mileage */

export const CLAIM_TYPES = ["expense", "mileage"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** Highest mileage rate the policy accepts: $5.00 per kilometre. */
export const MAX_MILEAGE_RATE_CENTS = 500;
/** Longest single mileage claim: 10,000 km. */
export const MAX_MILEAGE_DISTANCE_KM = 10_000;

export type MileageDetails = {
  distanceKm: number;
  rateCentsPerKm: number;
  fromLocation?: string;
  toLocation?: string;
  tripDescription?: string;
};

export function isMileageClaim(claim: { claimType?: string | null }): boolean {
  return claim.claimType === "mileage";
}

/**
 * Distance × rate, to the nearest cent (halves up). Worked in hundredths of a
 * kilometre so float error can't tip a half cent down (1.15 km × 50¢ is 58¢,
 * not the 57¢ `Math.round(1.15 * 50)` gives).
 */
export function mileageAmountCents(distanceKm: number, rateCentsPerKm: number): number {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(rateCentsPerKm)) return 0;
  const hundredthsKm = Math.round(distanceKm * 100);
  return Math.floor((hundredthsKm * rateCentsPerKm + 50) / 100);
}

/** "$0.68/km" */
export function formatMileageRate(rateCentsPerKm: number): string {
  return `$${(rateCentsPerKm / 100).toFixed(2)}/km`;
}

/** "42.5 km" */
export function formatDistanceKm(distanceKm: number): string {
  return `${distanceKm.toLocaleString("en-CA", { maximumFractionDigits: 2 })} km`;
}

/** Problems with a mileage claim before it is saved, against the policy's rate. */
export function validateMileage(details: Partial<MileageDetails> | null | undefined, configuredRateCentsPerKm: number | null | undefined): string[] {
  const errors: string[] = [];
  if (!configuredRateCentsPerKm) {
    errors.push("Set a mileage rate in the claim policy before submitting mileage claims.");
    return errors;
  }
  const distance = details?.distanceKm;
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) errors.push("Enter the distance driven in kilometres.");
  else if (distance > MAX_MILEAGE_DISTANCE_KM) errors.push(`Enter a distance under ${MAX_MILEAGE_DISTANCE_KM.toLocaleString("en-CA")} km.`);
  else if (Math.abs(Math.round(distance * 100) - distance * 100) > 1e-6) errors.push("Enter the distance to at most two decimal places.");
  if (!String(details?.tripDescription ?? "").trim() && !(String(details?.fromLocation ?? "").trim() && String(details?.toLocation ?? "").trim())) {
    errors.push("Describe the trip, or enter where it started and ended.");
  }
  return errors;
}

/** Short label for tables: "Mileage · 42 km". */
export function mileageSummary(details: Pick<MileageDetails, "distanceKm"> | null | undefined): string {
  return details ? `Mileage · ${formatDistanceKm(details.distanceKm)}` : "Mileage";
}

/* ------------------------------------------------------------ duplicates */

export const DUPLICATE_WINDOW_DAYS = 14;

export type DuplicateCandidate = {
  _id: string;
  /** Claimant user id, claimant name, member id or customer id: who the money is for. */
  partyKey: string;
  amountCents: number;
  /** YYYY-MM-DD (or an ISO timestamp). */
  date: string;
  title: string;
};

/**
 * The closest earlier-or-nearby record for the same party with the same amount
 * within ±14 days. A soft hint only: nothing is ever blocked on it.
 */
export function findLikelyDuplicate(
  subject: Omit<DuplicateCandidate, "title" | "_id"> & { _id?: string },
  candidates: readonly DuplicateCandidate[],
  windowDays = DUPLICATE_WINDOW_DAYS,
): (DuplicateCandidate & { daysApart: number }) | null {
  const party = subject.partyKey.trim().toLowerCase();
  const amount = Math.abs(Math.round(subject.amountCents));
  if (!party || amount === 0 || !/^\d{4}-\d{2}-\d{2}/.test(subject.date)) return null;
  let best: (DuplicateCandidate & { daysApart: number }) | null = null;
  for (const candidate of candidates) {
    if (subject._id && String(candidate._id) === String(subject._id)) continue;
    if (candidate.partyKey.trim().toLowerCase() !== party) continue;
    if (Math.abs(Math.round(candidate.amountCents)) !== amount) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(candidate.date)) continue;
    const daysApart = Math.abs(daysBetweenDates(candidate.date, subject.date));
    if (daysApart > windowDays) continue;
    if (!best || daysApart < best.daysApart) best = { ...candidate, daysApart };
  }
  return best;
}

/** Party key for a claim: the linked user when there is one, else the name. */
export function claimPartyKey(claim: { claimantUserId?: string | null; claimantName?: string | null }): string {
  return claim.claimantUserId ? `user:${claim.claimantUserId}` : `name:${String(claim.claimantName ?? "").trim().toLowerCase()}`;
}

/* ------------------------------------------------------------- reminders */

/** Approvers can be reminded about a claim at most once per 24 hours. */
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** When the next reminder may be sent, or null if one can be sent now. */
export function nextReminderAt(lastReminderAtISO: string | null | undefined, now: Date = new Date()): string | null {
  if (!lastReminderAtISO) return null;
  const last = Date.parse(lastReminderAtISO);
  if (!Number.isFinite(last)) return null;
  const next = last + REMINDER_COOLDOWN_MS;
  return next > now.getTime() ? new Date(next).toISOString() : null;
}
