/** Shared hosted/local receipt actions. Issued content is immutable; correction uses void and replacement. */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable } from "./permissions";
import { isCalendarDate } from "../invoicing";
import { assessCharityRegistration, normalizeCharityNumber, type CharityRegistrationRevision } from "../receipting/registration";
import { RECEIPT_RULE_VERSION, receiptDateInOrganization, receiptRequestFingerprint, receiptText, validateReceiptInput, type ReceiptIssueInput } from "../receipting/policy";
import { assertRegistrationEvidenceCurrent, listCharityRegistrationRevisions } from "./receiptRegistration";
import { allocateReceiptSerial, assertReceiptLinks, receiptSignedCopySnapshot } from "./receiptEvidence";
import { assertOfficialReceiptOrganization } from "../organization/resolveContext";

export { listCharityRegistrationRevisions, receiptRegistrationHistoryPortable, receiptRecordRegistrationPortable } from "./receiptRegistration";
export { nextReceiptSerial, receiptEvidenceForReviewPortable } from "./receiptEvidence";

const RECEIPT_READ_LIMIT = 5000;

export async function receiptsListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requirePermissionPortable(ctx, societyId, "financials:read");
  const rows = await ctx.db.query("donationReceipts")
    .withIndex("by_society", q => q.eq("societyId", societyId))
    .omitFields("requestFingerprint").take(RECEIPT_READ_LIMIT + 1);
  if (rows.length > RECEIPT_READ_LIMIT) throw new Error("This receipt register exceeds the current 5,000-record view. Export the preserved records for review; no records were removed.");
  return rows;
}

/** Acknowledgements issue immediately; official paper receipts reserve a number and await signed evidence. */
export async function receiptIssuePortable(ctx: PortableMutationCtx, args: ReceiptIssueInput): Promise<string> {
  const actor = await requirePermissionPortable(ctx, args.societyId, "financials:write");
  const key = receiptText(args.idempotencyKey, "Request identifier", 120, true)!;
  const fingerprint = receiptRequestFingerprint(args);
  const replay = await ctx.db.query("donationReceipts")
    .withIndex("by_society_request", q => q.eq("societyId", args.societyId).eq("idempotencyKey", key)).unique();
  if (replay) {
    if (replay.requestFingerprint !== fingerprint) throw new Error("This request identifier already belongs to a different receipt. Start a new preparation.");
    return replay._id;
  }
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  const now = new Date().toISOString();
  const onDate = receiptDateInOrganization(society, new Date(now));
  const input = validateReceiptInput(args, onDate);
  const giftRecordId = await assertReceiptLinks(ctx, input);
  const official = input.documentKind === "official_tax_receipt";
  let registration: CharityRegistrationRevision | undefined;
  if (official) {
    assertOfficialReceiptOrganization(society);
    const assessment = assessCharityRegistration(await listCharityRegistrationRevisions(ctx, args.societyId), { onDate, receivedOn: input.receivedOnISO });
    if (assessment.readiness !== "ready" || !assessment.revision) throw new Error(assessment.reasons.map(reason => reason.message).join(" "));
    registration = assessment.revision;
    await assertRegistrationEvidenceCurrent(ctx, args.societyId, registration);
    if (args.charityNumber && normalizeCharityNumber(args.charityNumber) !== registration.charityNumber) throw new Error("The supplied charity number does not match the reviewed organization registration.");
  }
  const issuerName = registration?.registeredName || receiptText(society.legalName || society.name, "Organization name", 250, true)!;
  const issuerAddress = registration?.registeredAddress || receiptText(society.registeredOfficeAddress, "Organization address", 1500) || "";
  const receiptNumber = await allocateReceiptSerial(ctx, args.societyId);
  const id = await ctx.db.insert("donationReceipts", {
    ...input,
    charityNumber: registration?.charityNumber || "",
    receiptNumber,
    serialAssessed: true,
    currency: "CAD",
    issueStatus: official ? "prepared" : "issued",
    preparedAtISO: now,
    preparedByUserId: actor._id,
    ...(giftRecordId ? { giftRecordId } : {}),
    ...(official ? {} : { issuedAtISO: now, issuedByUserId: actor._id, issuedOn: onDate }),
    requestFingerprint: fingerprint,
    issuerSnapshot: {
      name: issuerName,
      address: issuerAddress,
      ...(registration ? {
        charityNumber: registration.charityNumber!,
        registrationRevisionId: registration._id,
        registrationEffectiveFrom: registration.effectiveFrom!,
        ...(registration.effectiveTo ? { registrationEffectiveTo: registration.effectiveTo } : {}),
        evidenceDocumentIds: registration.evidenceDocumentIds,
        evidenceSnapshots: registration.evidenceSnapshots!,
      } : {}),
    },
    ...(official ? { giftAssessmentSnapshot: {
      ruleVersion: RECEIPT_RULE_VERSION,
      giftType: "cash",
      advantageAmountCents: 0,
      eligibleAmountCents: input.amountCents,
      eligibilityConfirmedByUserId: actor._id,
      assessedAtISO: now,
    } } : {}),
  });
  if (!giftRecordId) await ctx.db.patch(id, { giftRecordId: id });
  if (input.replacesReceiptId) await ctx.db.patch(input.replacesReceiptId, { replacementReceiptId: id });
  return id;
}

export async function receiptFinalizeOfficialPortable(
  ctx: PortableMutationCtx,
  args: { id: string; signedCopyDocumentId: string; expectedSignedCopyRevision: string; signedOn: string; signatoryName: string; authorityConfirmed: boolean },
): Promise<string> {
  const receipt = await ctx.db.get(args.id, "donationReceipts");
  if (!receipt) throw new Error("donationReceipts not found.");
  const societyId = String(receipt.societyId);
  const actor = await requirePermissionPortable(ctx, societyId, "financials:write");
  await getOwned(ctx, "donationReceipts", args.id, societyId);
  const signatoryName = receiptText(args.signatoryName, "Authorized signatory name", 250, true)!;
  if (receipt.voidedAtISO) throw new Error("A voided receipt cannot be issued.");
  if (receipt.documentKind !== "official_tax_receipt" || !receipt.issuerSnapshot || !receipt.giftAssessmentSnapshot) throw new Error("Only a reviewed official receipt preparation can be finalized.");
  if (args.authorityConfirmed !== true) throw new Error("Confirm the signatory's authority and that the signed copy matches the prepared receipt.");
  if (args.signedOn !== receipt.intendedIssueDate || !isCalendarDate(args.signedOn)) throw new Error("The signed issue date must match the date printed on this preparation. Void and reprepare when the issue date changes.");
  if (receipt.issueStatus === "issued") {
    if (receipt.signedCopyDocumentId !== args.signedCopyDocumentId || receipt.signatoryName !== signatoryName || receipt.issuedOn !== args.signedOn || receipt.signedCopySnapshot?.fingerprint !== args.expectedSignedCopyRevision) throw new Error("This official receipt was already issued with different signature evidence.");
    return receipt._id;
  }
  if (receipt.issueStatus !== "prepared") throw new Error("Only a numbered preparation can be finalized.");
  validateReceiptInput({ ...receipt, societyId, documentKind: "official_tax_receipt", intendedIssueDate: args.signedOn } as ReceiptIssueInput, args.signedOn);
  if (receipt.giftAssessmentSnapshot.ruleVersion !== RECEIPT_RULE_VERSION || receipt.giftAssessmentSnapshot.giftType !== "cash" || receipt.giftAssessmentSnapshot.advantageAmountCents !== 0 || receipt.giftAssessmentSnapshot.eligibleAmountCents !== receipt.amountCents) throw new Error("The gift assessment no longer matches this preparation. Review and reprepare it.");
  if (receipt.giftRecordId) {
    const related = await ctx.db.query("donationReceipts").withIndex("by_gift_record", q => q.eq("giftRecordId", receipt.giftRecordId)).take(201);
    if (related.length > 200 || related.some(row => row._id !== receipt._id && row.documentKind === "official_tax_receipt" && !row.voidedAtISO)) throw new Error("This gift has conflicting active official receipt records. Review them before issuing.");
  }
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  assertOfficialReceiptOrganization(society);
  const now = new Date().toISOString();
  const onDate = receiptDateInOrganization(society, new Date(now));
  if (args.signedOn > onDate) throw new Error("The signed issue date cannot be in the future.");
  const history = await listCharityRegistrationRevisions(ctx, societyId);
  const assessment = assessCharityRegistration(history, { onDate: args.signedOn, receivedOn: receipt.receivedOnISO });
  const current = assessCharityRegistration(history, { onDate });
  if (assessment.readiness !== "ready" || current.readiness !== "ready" || assessment.revision?._id !== receipt.issuerSnapshot.registrationRevisionId) throw new Error("Registration evidence changed or no longer supports this preparation. Review the gift and void/reprepare before issuing.");
  await assertRegistrationEvidenceCurrent(ctx, societyId, assessment.revision!);
  const signedCopy = await receiptSignedCopySnapshot(ctx, societyId, args.signedCopyDocumentId, args.expectedSignedCopyRevision);
  await ctx.db.patch(args.id, {
    issueStatus: "issued",
    issuedAtISO: now,
    issuedOn: args.signedOn,
    issuedByUserId: actor._id,
    signatoryName,
    signatureMethod: "wet_ink",
    signatureAuthorityConfirmedAtISO: now,
    signedCopyDocumentId: args.signedCopyDocumentId,
    signedCopySnapshot: signedCopy,
  });
  return args.id;
}

export async function receiptVoidPortable(ctx: PortableMutationCtx, { id, reason }: { id: string; reason: string }): Promise<void> {
  const candidate = await ctx.db.get(id, "donationReceipts");
  if (!candidate) throw new Error("donationReceipts not found.");
  const actor = await requirePermissionPortable(ctx, String(candidate.societyId), "financials:write");
  await getOwned(ctx, "donationReceipts", id, String(candidate.societyId));
  const voidReason = receiptText(reason, "Void reason", 1500, true)!;
  if (candidate.voidedAtISO) return;
  await ctx.db.patch(id, { voidedAtISO: new Date().toISOString(), voidReason, voidedByUserId: actor._id });
}

export async function receiptRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const receipt = await ctx.db.get(id, "donationReceipts");
  if (!receipt) return;
  await requirePermissionPortable(ctx, String(receipt.societyId), "financials:write");
  await getOwned(ctx, "donationReceipts", id, String(receipt.societyId));
  if (receipt.receiptNumber || receipt.documentKind) throw new Error("Numbered donation records cannot be deleted. Void the record to preserve its history and serial number.");
  await ctx.db.delete(id);
}
