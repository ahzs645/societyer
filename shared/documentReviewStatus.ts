/**
 * One review vocabulary for documents and source evidence (finding D-12).
 *
 * Documents historically stored snake_case statuses (in_review,
 * needs_signature, …) while imports wrote PascalCase ("NeedsReview"), which
 * the UI showed as "Not reviewed". Every reader goes through
 * `normalizeDocumentReviewStatus`; writers store the normalized key.
 */

/**
 * "transposed": the document's contents were reviewed field by field and
 * landed in native records (AI-led intake promotion). It is not an approval
 * of the document itself, but nothing about it is waiting on a person.
 */
export const DOCUMENT_REVIEW_STATUSES = ["none", "needs_review", "in_review", "needs_signature", "transposed", "approved", "blocked"] as const;
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

const DOCUMENT_STATUS_ALIASES: Record<string, DocumentReviewStatus> = {
  "": "none",
  none: "none",
  notreviewed: "none",
  needsreview: "needs_review",
  pending: "needs_review",
  pendingreview: "needs_review",
  toreview: "needs_review",
  unreviewed: "needs_review",
  inreview: "in_review",
  reviewing: "in_review",
  underreview: "in_review",
  needssignature: "needs_signature",
  awaitingsignature: "needs_signature",
  transposed: "transposed",
  transposedtorecords: "transposed",
  approved: "approved",
  reviewed: "approved",
  verified: "approved",
  final: "approved",
  blocked: "blocked",
  rejected: "blocked",
};

function statusMatchKey(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z]+/g, "");
}

export function normalizeDocumentReviewStatus(value: unknown): DocumentReviewStatus {
  return DOCUMENT_STATUS_ALIASES[statusMatchKey(value)] ?? "needs_review";
}

/** Value to store: undefined for "none" so cleared statuses stay absent. */
export function storedDocumentReviewStatus(value: unknown): DocumentReviewStatus | undefined {
  const normalized = normalizeDocumentReviewStatus(value);
  return normalized === "none" ? undefined : normalized;
}

export function documentReviewStatusLabel(value: unknown) {
  switch (normalizeDocumentReviewStatus(value)) {
    case "needs_review": return "Needs review";
    case "in_review": return "In review";
    case "needs_signature": return "Needs signature";
    case "transposed": return "Transposed";
    case "approved": return "Approved";
    case "blocked": return "Blocked";
    default: return "Not reviewed";
  }
}

export function documentReviewStatusTone(value: unknown) {
  switch (normalizeDocumentReviewStatus(value)) {
    case "approved": return "success" as const;
    case "transposed": return "success" as const;
    case "needs_signature": return "warn" as const;
    case "needs_review": return "warn" as const;
    case "blocked": return "danger" as const;
    case "in_review": return "info" as const;
    default: return "neutral" as const;
  }
}

/** True while a person still has to look at the document. */
export function documentNeedsAttention(value: unknown) {
  const status = normalizeDocumentReviewStatus(value);
  return status === "needs_review" || status === "in_review" || status === "needs_signature" || status === "blocked";
}

/* ----------------------------- source evidence ---------------------------- */

export const EVIDENCE_REVIEW_STATUSES = ["NeedsReview", "Linked", "Verified", "Rejected"] as const;
export type EvidenceReviewStatus = (typeof EVIDENCE_REVIEW_STATUSES)[number];

export function normalizeEvidenceReviewStatus(value: unknown): EvidenceReviewStatus {
  const key = statusMatchKey(value);
  if (key === "linked") return "Linked";
  if (key === "verified" || key === "approved" || key === "reviewed") return "Verified";
  if (key === "rejected" || key === "blocked") return "Rejected";
  return "NeedsReview";
}

export function evidenceReviewStatusLabel(value: unknown) {
  switch (normalizeEvidenceReviewStatus(value)) {
    case "Linked": return "Linked";
    case "Verified": return "Verified";
    case "Rejected": return "Rejected";
    default: return "Needs review";
  }
}

export function evidenceReviewStatusTone(value: unknown) {
  switch (normalizeEvidenceReviewStatus(value)) {
    case "Linked": return "info" as const;
    case "Verified": return "success" as const;
    case "Rejected": return "danger" as const;
    default: return "warn" as const;
  }
}

/**
 * Intake promotion: a source document whose fields were reviewed into native
 * records leaves the review backlog. Statuses a person set deliberately
 * (needs signature, approved, blocked) are kept.
 */
export function reviewStatusAfterTransposition(current: unknown): DocumentReviewStatus | undefined {
  const status = normalizeDocumentReviewStatus(current);
  return status === "none" || status === "needs_review" || status === "in_review" ? "transposed" : undefined;
}
