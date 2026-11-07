import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable } from "./permissions";
import { requireDocumentAccess } from "./documents";
import { isCalendarDate } from "../invoicing";
import { receiptDateInOrganization, receiptText } from "../receipting/policy";
import { captureReceiptEvidence } from "./receiptEvidence";
import { hasCompleteReceiptEvidence, type ReceiptEvidenceSnapshot } from "../receipting/evidence";
import {
  CHARITY_REGISTRATION_HISTORY_LIMIT, CHARITY_REGISTRATION_TYPE,
  assessCharityRegistration, currentCharityRegistration, normalizeCharityNumber,
  type CharityRegistrationRevision, type CharityRegistrationStatus,
} from "../receipting/registration";

/** Complete and bounded: a truncated history must never become an eligibility decision. */
export async function listCharityRegistrationRevisions(ctx: PortableQueryCtx, societyId: string): Promise<CharityRegistrationRevision[]> {
  const rows = await ctx.db.query<CharityRegistrationRevision>("organizationTaxRegistrations")
    .withIndex("by_society", q => q.eq("societyId", societyId)).take(CHARITY_REGISTRATION_HISTORY_LIMIT + 1);
  if (rows.length > CHARITY_REGISTRATION_HISTORY_LIMIT) throw new Error("The registration history needs a reviewed migration before another assessment can be made.");
  return rows;
}

export async function checkedReceiptEvidenceDocuments(ctx: PortableQueryCtx, societyId: string, ids: readonly string[]) {
  if (ids.length > 20) throw new Error("Attach no more than 20 evidence documents to one registration revision.");
  if (ids.length) await requirePermissionPortable(ctx, societyId, "documents:read");
  for (const id of ids) {
    await getOwned(ctx, "documents", id, societyId);
    await requireDocumentAccess(ctx, id);
  }
}

export async function receiptRegistrationHistoryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requirePermissionPortable(ctx, societyId, "society:read");
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  const history = await listCharityRegistrationRevisions(ctx, societyId);
  const onDate = receiptDateInOrganization(society);
  return {
    history: history.slice().sort((a, b) => b.revisionNumber - a.revisionNumber),
    current: currentCharityRegistration(history).revision ?? null,
    assessment: assessCharityRegistration(history, { onDate }),
    onDate,
  };
}

export interface RecordCharityRegistrationInput {
  societyId: string;
  expectedRevisionId?: string;
  status: CharityRegistrationStatus;
  evidenceReviewed: boolean;
  charityNumber?: string;
  registeredName?: string;
  registeredAddress?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  evidenceDocumentIds?: string[];
  expectedEvidenceFingerprints?: Array<{ documentId: string; fingerprint: string }>;
  authorityReference?: string;
  notes?: string;
}

export async function receiptRecordRegistrationPortable(ctx: PortableMutationCtx, args: RecordCharityRegistrationInput): Promise<string> {
  const actor = await requirePermissionPortable(ctx, args.societyId, "society:write");
  if (!["unknown", "applied", "registered", "inactive"].includes(args.status)) throw new Error("Choose a supported registration status.");
  if (typeof args.evidenceReviewed !== "boolean") throw new Error("Record whether the registration evidence has been reviewed.");
  const history = await listCharityRegistrationRevisions(ctx, args.societyId);
  const current = currentCharityRegistration(history);
  if (current.conflict) throw new Error("The registration history conflicts and needs review before a new revision can be recorded.");
  if ((args.expectedRevisionId || undefined) !== current.revision?._id) throw new Error("Registration changed while you were editing. Reload the current revision before saving.");
  if (history.length >= CHARITY_REGISTRATION_HISTORY_LIMIT) throw new Error("The registration history needs a reviewed migration before another revision can be recorded.");
  const suppliedNumber = receiptText(args.charityNumber, "Charity registration number", 40);
  const charityNumber = suppliedNumber ? normalizeCharityNumber(suppliedNumber) : undefined;
  if (suppliedNumber && !charityNumber) throw new Error("Use the full CRA charity number: nine digits, RR, then four digits.");
  const registeredName = receiptText(args.registeredName, "Registered charity name", 250);
  const registeredAddress = receiptText(args.registeredAddress, "Registered charity address", 1500);
  const effectiveFrom = receiptText(args.effectiveFrom, "Effective start date", 10);
  const effectiveTo = receiptText(args.effectiveTo, "Final effective date", 10);
  const authorityReference = receiptText(args.authorityReference, "Authority reference", 1000);
  const notes = receiptText(args.notes, "Review notes", 3000);
  if (effectiveFrom && !isCalendarDate(effectiveFrom)) throw new Error("Choose a valid effective start date.");
  if (effectiveTo && (!isCalendarDate(effectiveTo) || !effectiveFrom || effectiveTo < effectiveFrom)) throw new Error("The final effective date must be on or after the effective start date.");
  const evidenceDocumentIds = [...new Set(args.evidenceDocumentIds ?? [])];
  await checkedReceiptEvidenceDocuments(ctx, args.societyId, evidenceDocumentIds);
  if (args.evidenceReviewed && !evidenceDocumentIds.length) throw new Error("Link the evidence documents before recording their review.");
  let evidenceSnapshots: ReceiptEvidenceSnapshot[] | undefined;
  if (args.evidenceReviewed) {
    evidenceSnapshots = await Promise.all(evidenceDocumentIds.map(id => captureReceiptEvidence(ctx, args.societyId, id)));
    const expected = args.expectedEvidenceFingerprints;
    if (!expected || expected.length !== evidenceSnapshots.length || new Set(expected.map(item => item.documentId)).size !== expected.length
      || evidenceSnapshots.some(snapshot => !expected.some(item => item.documentId === snapshot.documentId && item.fingerprint === snapshot.fingerprint))) throw new Error("The evidence changed or was not reviewed. Review the current documents and confirm their fingerprints before saving.");
  }
  if (args.evidenceReviewed && ["registered", "inactive"].includes(args.status)
    && (!charityNumber || !registeredName || !registeredAddress || !effectiveFrom)) throw new Error("Reviewed registration evidence needs the CRA number, registered name, registered address and effective start date.");
  if (args.status === "inactive" && (!effectiveFrom || !effectiveTo || !notes)) throw new Error("An inactive registration needs its original start date, final effective date and reason for the change.");
  if (current.revision?.status === "registered" && (args.status !== "registered" || charityNumber !== current.revision.charityNumber) && !notes) throw new Error("Explain the change from the previous registered status or number in the review notes.");
  const now = new Date().toISOString();
  return ctx.db.insert("organizationTaxRegistrations", {
    societyId: args.societyId,
    registrationType: CHARITY_REGISTRATION_TYPE,
    revisionNumber: (current.revision?.revisionNumber ?? 0) + 1,
    ...(current.revision ? { supersedesId: current.revision._id } : {}),
    status: args.status, evidenceReviewed: args.evidenceReviewed,
    ...(charityNumber ? { charityNumber } : {}),
    ...(registeredName ? { registeredName } : {}),
    ...(registeredAddress ? { registeredAddress } : {}),
    ...(effectiveFrom ? { effectiveFrom } : {}), ...(effectiveTo ? { effectiveTo } : {}),
    evidenceDocumentIds,
    ...(evidenceSnapshots ? { evidenceSnapshots } : {}),
    ...(authorityReference ? { authorityReference } : {}), ...(notes ? { notes } : {}),
    recordedByUserId: actor._id, recordedAtISO: now,
    ...(args.evidenceReviewed ? { reviewedByUserId: actor._id, reviewedAtISO: now } : {}),
  });
}

/** Do not silently promote a replacement file to evidence of the earlier registration review. */
export async function assertRegistrationEvidenceCurrent(ctx: PortableQueryCtx, societyId: string, revision: CharityRegistrationRevision) {
  if (!hasCompleteReceiptEvidence(revision.evidenceDocumentIds, revision.evidenceSnapshots)) throw new Error("Review and retain the registration evidence before a new official action.");
  for (const expected of revision.evidenceSnapshots!) {
    const current = await captureReceiptEvidence(ctx, societyId, expected.documentId);
    if (current.fingerprint !== expected.fingerprint) throw new Error("Registration evidence changed after its review. Record a new reviewed registration revision before proceeding.");
  }
}
