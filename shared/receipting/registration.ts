import { isCalendarDate } from "../invoicing";
import { hasCompleteReceiptEvidence, type ReceiptEvidenceSnapshot } from "./evidence";

export const CHARITY_REGISTRATION_TYPE = "CA-CRA-CHARITY" as const;
export const CHARITY_REGISTRATION_HISTORY_LIMIT = 200;
export type CharityRegistrationStatus = "unknown" | "applied" | "registered" | "inactive";

export interface RegistrationReason {
  code: string;
  message: string;
  nextAction?: string;
}

/** One current assessment, with immutable revisions; dates describe its known registration period. */
export interface CharityRegistrationRevision {
  _id: string;
  societyId: string;
  registrationType: typeof CHARITY_REGISTRATION_TYPE;
  revisionNumber: number;
  supersedesId?: string;
  status: CharityRegistrationStatus;
  evidenceReviewed: boolean;
  charityNumber?: string;
  registeredName?: string;
  registeredAddress?: string;
  effectiveFrom?: string;
  /** Inclusive final day of the recorded registration period. */
  effectiveTo?: string;
  evidenceDocumentIds: string[];
  evidenceSnapshots?: ReceiptEvidenceSnapshot[];
  authorityReference?: string;
  notes?: string;
  recordedByUserId: string;
  recordedAtISO: string;
  reviewedByUserId?: string;
  reviewedAtISO?: string;
}

/** Public supplier/profile projection: never includes account numbers, documents or reviewer identity. */
export interface CharityRegistrationProjection {
  _id: string;
  revisionNumber: number;
  supersedesId?: string;
  status: CharityRegistrationStatus;
  evidenceReviewed: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  registrationComplete: boolean;
}

type RegistrationFact = CharityRegistrationRevision | CharityRegistrationProjection;
export interface RegistrationAssessment<T extends RegistrationFact = CharityRegistrationRevision> {
  readiness: "ready" | "needs_information" | "needs_review" | "blocked";
  reasons: RegistrationReason[];
  revision?: T;
}

export function normalizeCharityNumber(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const number = value.replace(/[\s-]/g, "").toUpperCase();
  return /^\d{9}RR\d{4}$/.test(number) ? number : undefined;
}

function registrationComplete(row: RegistrationFact): boolean {
  if ("registrationComplete" in row) return row.registrationComplete;
  return Boolean(
    normalizeCharityNumber(row.charityNumber)
    && row.registeredName?.trim()
    && row.registeredAddress?.trim()
    && hasCompleteReceiptEvidence(row.evidenceDocumentIds, row.evidenceSnapshots)
    && row.reviewedByUserId
    && row.reviewedAtISO
    && row.effectiveFrom && isCalendarDate(row.effectiveFrom)
    && (!row.effectiveTo || (isCalendarDate(row.effectiveTo) && row.effectiveTo >= row.effectiveFrom)),
  );
}

export function projectCharityRegistrationHistory(history: readonly CharityRegistrationRevision[]): CharityRegistrationProjection[] {
  return history.map(row => ({
    _id: row._id,
    revisionNumber: row.revisionNumber,
    ...(row.supersedesId ? { supersedesId: row.supersedesId } : {}),
    status: row.status,
    evidenceReviewed: row.evidenceReviewed,
    ...(row.effectiveFrom ? { effectiveFrom: row.effectiveFrom } : {}),
    ...(row.effectiveTo ? { effectiveTo: row.effectiveTo } : {}),
    registrationComplete: registrationComplete(row),
  }));
}

export function currentCharityRegistration<T extends RegistrationFact>(history: readonly T[]): { revision?: T; conflict: boolean } {
  if (!history.length) return { conflict: false };
  const ordered = [...history].sort((a, b) => a.revisionNumber - b.revisionNumber);
  let previous: T | undefined;
  for (const row of ordered) {
    if (!row._id || !Number.isSafeInteger(row.revisionNumber) || row.revisionNumber !== (previous?.revisionNumber ?? 0) + 1
      || (row.supersedesId ?? undefined) !== previous?._id) return { conflict: true };
    previous = row;
  }
  return { revision: previous, conflict: false };
}

/** Assess one reviewed period and its corrections, including a closed historical
 * period. Disjoint historical periods require review before negative inference. */
export function charityRegistrationAtDate<T extends RegistrationFact>(history: readonly T[], onDate: string): {
  status: "registered" | "not_registered" | "unknown" | "conflict";
  revision?: T;
  reasons: RegistrationReason[];
} {
  const current = currentCharityRegistration(history);
  if (current.conflict) return { status: "conflict", reasons: [{ code: "REGISTRATION_HISTORY_CONFLICT", message: "The registration revisions conflict. Review their history before proceeding.", nextAction: "review_registration" }] };
  const revision = current.revision;
  if (!isCalendarDate(onDate)) return { status: "unknown", revision, reasons: [{ code: "REGISTRATION_DATE_REQUIRED", message: "Choose a valid assessment date." }] };
  if (!revision || !revision.evidenceReviewed || !registrationComplete(revision)
    || (revision.status !== "registered" && revision.status !== "inactive")) {
    return { status: "unknown", revision, reasons: [{ code: "REGISTRATION_NOT_ESTABLISHED", message: revision?.status === "applied" ? "The charity application is pending; registration has not been established." : "Record and review the applicable charity-registration evidence.", nextAction: "review_registration" }] };
  }
  if (revision.status === "inactive" && !revision.effectiveTo) return { status: "unknown", revision, reasons: [{ code: "REGISTRATION_END_REQUIRED", message: "Record the final effective date for the inactive registration.", nextAction: "review_registration" }] };
  const inside = onDate >= revision.effectiveFrom! && (!revision.effectiveTo || onDate <= revision.effectiveTo);
  if (inside) return { status: "registered", revision, reasons: [] };
  // A new registration period cannot erase reviewed coverage of an earlier
  // period. Overlapping revisions still correct the same period: an older
  // open-ended revision must not defeat its later recorded end date.
  const earlierDisjointCoverage = history.some(previous => previous.revisionNumber < revision.revisionNumber
    && previous.evidenceReviewed && registrationComplete(previous)
    && (previous.status === "registered" || (previous.status === "inactive" && previous.effectiveTo))
    && onDate >= previous.effectiveFrom! && (!previous.effectiveTo || onDate <= previous.effectiveTo)
    && ((previous.effectiveTo && previous.effectiveTo < revision.effectiveFrom!)
      || (revision.effectiveTo && revision.effectiveTo < previous.effectiveFrom!)));
  if (earlierDisjointCoverage) return { status: "conflict", revision, reasons: [{
    code: "REGISTRATION_MULTIPLE_PERIODS",
    message: "The date is covered by an earlier reviewed registration in a separate period. This workflow assesses one registration period at a time; review the historical periods before proceeding.",
    nextAction: "review_registration",
  }] };
  return { status: "not_registered", revision, reasons: [{ code: "REGISTRATION_OUTSIDE_PERIOD", message: "The date is outside the reviewed charity-registration period.", nextAction: "review_registration" }] };
}

/** Organization-side receipt check only. It does not establish gift eligibility or user authority. */
export function assessCharityRegistration<T extends RegistrationFact>(history: readonly T[], { onDate, receivedOn }: { onDate: string; receivedOn?: string }): RegistrationAssessment<T> {
  const atIssue = charityRegistrationAtDate(history, onDate);
  if (atIssue.status === "conflict") return { readiness: "needs_review", reasons: atIssue.reasons };
  if (atIssue.status !== "registered") return { readiness: "blocked", reasons: atIssue.reasons, ...(atIssue.revision ? { revision: atIssue.revision } : {}) };
  if (atIssue.revision?.status !== "registered") return { readiness: "blocked", reasons: [{ code: "REGISTRATION_INACTIVE", message: "An inactive registration cannot authorize a new official receipt. Review the applicable authority decision.", nextAction: "review_registration" }], revision: atIssue.revision };
  if (receivedOn) {
    const atGift = charityRegistrationAtDate(history, receivedOn);
    if (atGift.status === "conflict") return { readiness: "needs_review", reasons: atGift.reasons, revision: atIssue.revision };
    if (atGift.status !== "registered") return { readiness: "needs_review", reasons: [{ code: "GIFT_OUTSIDE_REGISTRATION_PERIOD", message: "The gift date is outside the reviewed registration period. A retrospective case needs a separately reviewed route.", nextAction: "review_gift" }], revision: atIssue.revision };
  }
  return { readiness: "ready", reasons: [], revision: atIssue.revision };
}
