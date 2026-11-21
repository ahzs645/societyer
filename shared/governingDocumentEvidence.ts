/**
 * Where the authoritative governing documents and privacy policy are held,
 * whether someone has verified that copy is current, and the privacy review
 * attestation. Pure and dependency-free: the dashboard rules, the portable
 * mutations and the profile UI all read the same answers from here.
 *
 * A missing document link in Societyer does not mean the organization has no
 * constitution or policy; it means Societyer does not have it identified. The
 * authoritative copy can be:
 *   - an uploaded document (the profile's `constitutionDocId` / `bylawsDocId` /
 *     `privacyPolicyDocId` link),
 *   - an external system reference (BC Registry, a records portal, a shared drive), or
 *   - a physical records location (the records office binder, a lawyer's minute book).
 * The two "held elsewhere" kinds live in `governingDocumentEvidence`, one entry
 * per field; an uploaded link always wins when both exist.
 *
 * Currentness is a separate attestation (`governingDocumentVerifications`): a
 * named person verified, as of a date, that the identified copy is the current
 * one. It is tied to the copy it verified, so replacing the document or the
 * external reference leaves the new copy unverified.
 */

export const EVIDENCE_FIELDS = ["constitutionDocId", "bylawsDocId", "privacyPolicyDocId"] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

export const HELD_ELSEWHERE_KINDS = ["external", "physical"] as const;
export type HeldElsewhereKind = (typeof HELD_ELSEWHERE_KINDS)[number];
export type EvidenceKind = "document" | HeldElsewhereKind;

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  document: "Uploaded document",
  external: "External system reference",
  physical: "Physical records location",
};

export type GoverningDocumentEvidenceEntry = {
  field: EvidenceField;
  kind: HeldElsewhereKind;
  /** A URL or system reference (external), or a description of where the paper copy is kept (physical). */
  reference: string;
  custodian?: string;
  version?: string;
  effectiveDate?: string;
  recordedAtISO: string;
  recordedByUserId?: string;
  recordedByName?: string;
};

export type GoverningDocumentVerification = {
  field: EvidenceField;
  /** The date the copy was confirmed current as of (YYYY-MM-DD). */
  verifiedAsOf: string;
  /** Version, consolidation date or registry filing reference that was checked. */
  versionReference?: string;
  notes?: string;
  /** What was verified: the uploaded document, or the held-elsewhere entry. */
  evidenceKind: EvidenceKind;
  documentId?: string;
  evidenceRecordedAtISO?: string;
  recordedAtISO: string;
  verifiedByUserId?: string;
  verifiedByName?: string;
};

export type PrivacyProgramReview = {
  /** Which policies and practices were reviewed. */
  policiesReviewed: string;
  versionOrEffectiveDate?: string;
  /** Where the policy and practices are maintained. */
  maintainedAt?: string;
  /** Unresolved findings; blocking ones keep the program outstanding. */
  unresolvedFindings?: string;
  /**
   * Whether the findings keep the program from counting as documented. False
   * when the reviewer judged them minor follow-ups with the program in place.
   * Stored when there are findings; an older review without it is blocking.
   */
  findingsBlocking?: boolean;
  /** The day the review took place (YYYY-MM-DD). */
  reviewedOn: string;
  reviewedAtISO: string;
  reviewedByUserId?: string;
  reviewedByName?: string;
};

export type EvidenceFacts = {
  constitutionDocId?: string | null;
  bylawsDocId?: string | null;
  privacyPolicyDocId?: string | null;
  governingDocumentEvidence?: readonly GoverningDocumentEvidenceEntry[] | null;
  governingDocumentVerifications?: readonly GoverningDocumentVerification[] | null;
  privacyProgramStatus?: string | null;
  privacyProgramReview?: PrivacyProgramReview | null;
};

export type IdentifiedEvidence =
  | { kind: "document"; documentId: string; heldElsewhere?: GoverningDocumentEvidenceEntry }
  | { kind: HeldElsewhereKind; entry: GoverningDocumentEvidenceEntry };

export function isEvidenceField(value: unknown): value is EvidenceField {
  return typeof value === "string" && (EVIDENCE_FIELDS as readonly string[]).includes(value);
}

export function isHeldElsewhereKind(value: unknown): value is HeldElsewhereKind {
  return typeof value === "string" && (HELD_ELSEWHERE_KINDS as readonly string[]).includes(value);
}

/** The held-elsewhere entry recorded for this field, if any. */
export function heldElsewhereEntry(facts: EvidenceFacts | null | undefined, field: EvidenceField) {
  return (facts?.governingDocumentEvidence ?? []).find((entry) => entry.field === field && entry.reference?.trim());
}

/** How Societyer knows where the authoritative copy is; null when it doesn't. */
export function identifiedEvidence(facts: EvidenceFacts | null | undefined, field: EvidenceField): IdentifiedEvidence | null {
  if (!facts) return null;
  const documentId = facts[field];
  const entry = heldElsewhereEntry(facts, field);
  if (documentId) return { kind: "document", documentId: String(documentId), ...(entry ? { heldElsewhere: entry } : {}) };
  return entry ? { kind: entry.kind, entry } : null;
}

export function hasIdentifiedEvidence(facts: EvidenceFacts | null | undefined, field: EvidenceField) {
  return identifiedEvidence(facts, field) !== null;
}

export type CurrentnessState = "missing" | "unverified" | "verified";

export type Currentness = {
  state: CurrentnessState;
  evidence: IdentifiedEvidence | null;
  /** The verification that applies to the copy identified now. */
  verification?: GoverningDocumentVerification;
  /** A verification exists but was made for a copy that has since changed. */
  staleVerification?: GoverningDocumentVerification;
};

/** Whether a verification was made for the copy identified now. */
export function verificationMatches(verification: GoverningDocumentVerification, evidence: IdentifiedEvidence) {
  if (verification.evidenceKind !== evidence.kind) return false;
  if (evidence.kind === "document") return String(verification.documentId ?? "") === evidence.documentId;
  return verification.evidenceRecordedAtISO === evidence.entry.recordedAtISO;
}

export function governingDocumentCurrentness(facts: EvidenceFacts | null | undefined, field: EvidenceField): Currentness {
  const evidence = identifiedEvidence(facts, field);
  if (!evidence) return { state: "missing", evidence: null };
  const verification = (facts?.governingDocumentVerifications ?? []).find((row) => row.field === field);
  if (verification && verificationMatches(verification, evidence)) return { state: "verified", evidence, verification };
  return { state: "unverified", evidence, ...(verification ? { staleVerification: verification } : {}) };
}

export type PrivacyProgramState =
  /** A review is recorded with a location and no unresolved findings, and the program is marked documented. */
  | "documented"
  /** As documented, with minor follow-ups the reviewer said don't block the program. */
  | "follow-ups"
  /** The latest review left unresolved findings that keep the program outstanding. */
  | "findings"
  /** The latest review didn't say where the policy is maintained, and no policy evidence is identified. */
  | "no-location"
  /** Marked documented (or a policy is linked) without a recorded review attestation. */
  | "unattested"
  /** Not marked documented and no review recorded. */
  | "outstanding";

export type PrivacyProgramAssessment = {
  state: PrivacyProgramState;
  status: string;
  review?: PrivacyProgramReview;
};

/** Where the privacy policy is maintained, per the review or the identified evidence. */
export function privacyPolicyLocationRecorded(facts: EvidenceFacts | null | undefined, review?: PrivacyProgramReview | null) {
  return Boolean(review?.maintainedAt?.trim()) || hasIdentifiedEvidence(facts, "privacyPolicyDocId");
}

/** The review's unresolved findings, if any. */
export function privacyReviewFindings(review: PrivacyProgramReview | null | undefined): string | undefined {
  return review?.unresolvedFindings?.trim() || undefined;
}

/** Findings keep the program outstanding unless the reviewer said they are minor follow-ups. */
export function privacyFindingsBlocking(review: PrivacyProgramReview | null | undefined): boolean {
  return Boolean(privacyReviewFindings(review)) && review?.findingsBlocking !== false;
}

/**
 * The privacy program's standing. The review is an attestation by a named
 * person, not an automated conclusion: Societyer records what they reviewed,
 * where it is kept and what is unresolved, and whether the reviewer judged
 * the findings minor follow-ups with the program in place.
 */
export function privacyProgramAssessment(facts: EvidenceFacts | null | undefined): PrivacyProgramAssessment {
  const status = facts?.privacyProgramStatus ?? (facts?.privacyPolicyDocId ? "Documented" : "Unknown");
  const review = facts?.privacyProgramReview ?? undefined;
  if (review) {
    if (privacyFindingsBlocking(review)) return { state: "findings", status, review };
    if (!privacyPolicyLocationRecorded(facts, review)) return { state: "no-location", status, review };
    if (status === "Documented") return { state: privacyReviewFindings(review) ? "follow-ups" : "documented", status, review };
    return { state: "outstanding", status, review };
  }
  return { state: status === "Documented" ? "unattested" : "outstanding", status };
}

/**
 * Where the organization profile records evidence held elsewhere, verifies
 * currentness or records the privacy review; the Documents tab opens the form.
 */
export function governingEvidenceHref(record: "held-elsewhere" | "verify" | "privacy-review", field: EvidenceField) {
  return `/app/society?tab=documents&record=${record}&field=${field}#governing-documents`;
}

/** "Reviewed by Jane Doe · 2026-11-21" style attribution. */
export function attestationLine(verb: string, name: string | undefined, date: string | undefined) {
  return [`${verb} by ${name?.trim() || "a workspace member"}`, date].filter(Boolean).join(" · ");
}

export function shortText(value: string | undefined, max = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Trimmed text or undefined; throws past `max` characters. */
export function optionalText(value: unknown, label: string, max = 500): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${label} is too long (${max} characters at most).`);
  return text || undefined;
}

export function requiredText(value: unknown, label: string, max = 500): string {
  const text = optionalText(value, label, max);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
