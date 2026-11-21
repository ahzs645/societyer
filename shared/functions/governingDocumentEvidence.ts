/**
 * PORTABLE FUNCTIONS: evidence for governing documents and the privacy policy.
 *
 * - `society:setGoverningDocumentEvidence` records (or clears) where the
 *   authoritative constitution, bylaws / articles, or privacy policy is held
 *   when it isn't uploaded: an external system reference or a physical
 *   records location, with custodian and version.
 * - `society:verifyGoverningDocumentCurrent` records "verified current as of
 *   <date> by <name>" for the copy identified now, separately from linking it.
 * - `society:recordPrivacyReview` records an accountable privacy review: what
 *   was reviewed, its version, where it is maintained, who reviewed it and
 *   when, and unresolved findings. The program is marked Documented only when
 *   the review records a location and leaves no findings.
 *
 * Each writes the society row and an activity entry. Model and rules:
 * shared/governingDocumentEvidence.ts.
 */
import type { PortableMutationCtx } from "../portable/ctx";
import { isDateOnly, todayDateOnly } from "../dateOnly";
import { governingDocumentSlot } from "../governingDocuments";
import {
  EVIDENCE_KIND_LABELS,
  identifiedEvidence,
  isEvidenceField,
  isHeldElsewhereKind,
  optionalText,
  privacyPolicyLocationRecorded,
  requiredText,
  shortText,
  type EvidenceField,
  type GoverningDocumentEvidenceEntry,
  type GoverningDocumentVerification,
  type PrivacyProgramReview,
} from "../governingDocumentEvidence";
import { requirePermissionPortable } from "./permissions";

type SocietyRow = {
  _id: string;
  governingDocumentEvidence?: GoverningDocumentEvidenceEntry[];
  governingDocumentVerifications?: GoverningDocumentVerification[];
  privacyProgramReview?: PrivacyProgramReview;
  constitutionDocId?: string;
  bylawsDocId?: string;
  privacyPolicyDocId?: string;
  [key: string]: unknown;
};

const PRIVACY_PHRASE = "the privacy policy";

async function loadForWrite(ctx: PortableMutationCtx, societyId: string, field: unknown) {
  const user = await requirePermissionPortable(ctx, societyId, "society:write");
  const society = await ctx.db.get<SocietyRow>(societyId, "societies");
  if (!society) throw new Error("societies not found.");
  if (!isEvidenceField(field)) throw new Error("Unknown document.");
  // Governing-document fields follow the organization's kind (a BC company
  // keeps articles only); every organization may keep a privacy policy.
  const phrase = field === "privacyPolicyDocId" ? PRIVACY_PHRASE : governingDocumentSlot(society, field)?.phrase;
  if (!phrase) throw new Error("This organization doesn't keep that document on its profile.");
  const name = typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : undefined;
  return { user, society, field: field as EvidenceField, phrase, actor: { userId: String(user._id), name } };
}

async function logActivity(ctx: PortableMutationCtx, societyId: string, actor: string, action: string, summary: string) {
  await ctx.db.insert("activity", {
    societyId, actor, entityType: "society", subjectId: societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: societyId,
    action, summary: summary.slice(0, 300), createdAtISO: new Date().toISOString(),
  });
}

/** A date-only value no later than tomorrow (server UTC can run a day ahead of the user). */
function pastOrTodayDate(value: unknown, label: string): string {
  if (!isDateOnly(value)) throw new Error(`${label} must be a date.`);
  const tomorrow = todayDateOnly(Date.now() + 86_400_000);
  if (value > tomorrow) throw new Error(`${label} can't be in the future.`);
  return value;
}

export async function setGoverningDocumentEvidencePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    field: string;
    evidence: null | {
      kind: string;
      reference: string;
      custodian?: string;
      version?: string;
      effectiveDate?: string;
    };
  },
) {
  const { society, field, phrase, actor } = await loadForWrite(ctx, args.societyId, args.field);
  const others = (society.governingDocumentEvidence ?? []).filter((entry) => entry.field !== field);
  const previous = (society.governingDocumentEvidence ?? []).find((entry) => entry.field === field) ?? null;
  const actorName = actor.name ?? "You";

  if (args.evidence === null || args.evidence === undefined) {
    if (!previous) return { field, entry: null, previous: null, changed: false };
    await ctx.db.patch(args.societyId, { governingDocumentEvidence: others, updatedAt: Date.now() });
    await logActivity(ctx, args.societyId, actorName, "governing-document-evidence-cleared", `Removed where ${phrase} is held elsewhere`);
    return { field, entry: null, previous, changed: true };
  }

  const kind = args.evidence.kind;
  if (!isHeldElsewhereKind(kind)) throw new Error("Choose an external system reference or a physical records location.");
  const effectiveDate = optionalText(args.evidence.effectiveDate, "Effective date", 10);
  if (effectiveDate) pastOrTodayDate(effectiveDate, "Effective date");
  const entry: GoverningDocumentEvidenceEntry = withoutUndefined({
    field,
    kind,
    reference: requiredText(args.evidence.reference, kind === "external" ? "Reference or URL" : "Location", 1000),
    custodian: optionalText(args.evidence.custodian, "Custodian", 200),
    version: optionalText(args.evidence.version, "Version", 200),
    effectiveDate,
    recordedAtISO: new Date().toISOString(),
    recordedByUserId: actor.userId,
    recordedByName: actor.name,
  });
  await ctx.db.patch(args.societyId, { governingDocumentEvidence: [...others, entry], updatedAt: Date.now() });
  await logActivity(
    ctx, args.societyId, actorName,
    previous ? "governing-document-evidence-updated" : "governing-document-evidence-recorded",
    `Recorded ${phrase} as held elsewhere (${EVIDENCE_KIND_LABELS[kind].toLowerCase()}): ${shortText(entry.reference, 120)}`,
  );
  return { field, entry, previous, changed: true };
}

export async function verifyGoverningDocumentCurrentPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; field: string; verifiedAsOf: string; versionReference?: string; notes?: string },
) {
  const { society, field, phrase, actor } = await loadForWrite(ctx, args.societyId, args.field);
  const evidence = identifiedEvidence(society, field);
  // Verification is about a specific copy: link or record one first.
  if (!evidence) throw new Error(`Upload ${phrase} or record where it is held before verifying it is current.`);
  const verification: GoverningDocumentVerification = withoutUndefined({
    field,
    verifiedAsOf: pastOrTodayDate(args.verifiedAsOf, "Verified as of"),
    versionReference: optionalText(args.versionReference, "Version or filing reference", 200),
    notes: optionalText(args.notes, "Notes", 1000),
    evidenceKind: evidence.kind,
    documentId: evidence.kind === "document" ? evidence.documentId : undefined,
    evidenceRecordedAtISO: evidence.kind === "document" ? undefined : evidence.entry.recordedAtISO,
    recordedAtISO: new Date().toISOString(),
    verifiedByUserId: actor.userId,
    verifiedByName: actor.name,
  });
  const others = (society.governingDocumentVerifications ?? []).filter((row) => row.field !== field);
  await ctx.db.patch(args.societyId, { governingDocumentVerifications: [...others, verification], updatedAt: Date.now() });
  await logActivity(
    ctx, args.societyId, actor.name ?? "You", "governing-document-verified-current",
    `Verified ${phrase} current as of ${verification.verifiedAsOf}${verification.versionReference ? ` (${verification.versionReference})` : ""}`,
  );
  return { field, verification };
}

export async function recordPrivacyReviewPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    policiesReviewed: string;
    versionOrEffectiveDate?: string;
    maintainedAt?: string;
    reviewedOn: string;
    unresolvedFindings?: string;
  },
) {
  const { society, actor } = await loadForWrite(ctx, args.societyId, "privacyPolicyDocId");
  const review: PrivacyProgramReview = withoutUndefined({
    policiesReviewed: requiredText(args.policiesReviewed, "Policies and practices reviewed", 1000),
    versionOrEffectiveDate: optionalText(args.versionOrEffectiveDate, "Version or effective date", 200),
    maintainedAt: optionalText(args.maintainedAt, "Where they are maintained", 500),
    unresolvedFindings: optionalText(args.unresolvedFindings, "Unresolved findings", 2000),
    reviewedOn: pastOrTodayDate(args.reviewedOn, "Reviewed on"),
    reviewedAtISO: new Date().toISOString(),
    reviewedByUserId: actor.userId,
    reviewedByName: actor.name,
  });
  const located = privacyPolicyLocationRecorded(society, review);
  const documented = located && !review.unresolvedFindings;
  const status = documented ? "Documented" : "Needs review";
  await ctx.db.patch(args.societyId, {
    privacyProgramReview: review,
    privacyProgramStatus: status,
    privacyProgramReviewedAtISO: review.reviewedOn,
    updatedAt: Date.now(),
  });
  await logActivity(
    ctx, args.societyId, actor.name ?? "You", "privacy-program-reviewed",
    documented
      ? `Recorded privacy review: ${shortText(review.policiesReviewed, 120)}`
      : `Recorded privacy review with ${review.unresolvedFindings ? "unresolved findings" : "no policy location"}: ${shortText(review.policiesReviewed, 100)}`,
  );
  return { review, status, documented, missingLocation: !located };
}

function withoutUndefined<T extends Record<string, unknown>>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}
