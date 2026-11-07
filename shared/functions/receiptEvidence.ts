import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable } from "./permissions";
import { requireDocumentAccess } from "./documents";
import type { validateReceiptInput } from "../receipting/policy";
import { receiptEvidenceFingerprint, type ReceiptEvidenceSnapshot, type ReceiptEvidenceReview } from "../receipting/evidence";
import { DOCUMENT_STORAGE_CAPABILITIES } from "../storage/providerCapabilities";

const LEGACY_SERIAL_REVIEW_LIMIT = 5000;

/** Prepared and voided serials are retained. Imported non-serial receipt numbers do not shift this series. */
export function nextReceiptSerial(receiptNumbers: readonly unknown[]): number {
  let highest = 0;
  for (const value of receiptNumbers) {
    if (typeof value !== "string" || !/^\d+$/.test(value)) continue;
    const serial = Number(value);
    if (!Number.isSafeInteger(serial) || serial >= Number.MAX_SAFE_INTEGER) throw new Error("A legacy receipt serial needs review before the next number can be allocated.");
    highest = Math.max(highest, serial);
  }
  return highest + 1;
}

export async function allocateReceiptSerial(ctx: PortableMutationCtx, societyId: string) {
  const counter = await ctx.db.query("donationReceiptSequences").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
  const unassessed = await ctx.db.query("donationReceipts")
    .withIndex("by_society_serial_assessed", q => q.eq("societyId", societyId).eq("serialAssessed", undefined))
    .take(LEGACY_SERIAL_REVIEW_LIMIT + 1);
  if (unassessed.length > LEGACY_SERIAL_REVIEW_LIMIT) throw new Error("More than 5,000 imported receipt numbers need a reviewed sequence migration before issuing. No number has been allocated.");
  if (counter && (!Number.isSafeInteger(counter.lastSerial) || counter.lastSerial < 0 || counter.lastSerial >= Number.MAX_SAFE_INTEGER)) throw new Error("The receipt sequence needs review.");
  const next = Math.max(Number(counter?.lastSerial ?? 0) + 1, nextReceiptSerial(unassessed.map(row => row.receiptNumber)));
  const number = String(next).padStart(6, "0");
  const duplicate = await ctx.db.query("donationReceipts").withIndex("by_receipt_number", q => q.eq("societyId", societyId).eq("receiptNumber", number)).first();
  if (duplicate) throw new Error("The imported receipt sequence conflicts with the next number. Review the series before issuing.");
  // Metadata only: a historical receipt keeps its original kind, amounts, number and content.
  for (const row of unassessed) await ctx.db.patch(row._id, { serialAssessed: true });
  if (counter) await ctx.db.patch(counter._id, { lastSerial: next });
  else await ctx.db.insert("donationReceiptSequences", { societyId, lastSerial: next });
  return number;
}

export async function assertReceiptLinks(ctx: PortableQueryCtx, input: ReturnType<typeof validateReceiptInput>): Promise<string | undefined> {
  let giftRecordId: string | undefined;
  if (input.sourceAcknowledgementId) {
    if (input.documentKind !== "official_tax_receipt") throw new Error("Only an official receipt can link an earlier acknowledgement.");
    const acknowledgement = await getOwned(ctx, "donationReceipts", input.sourceAcknowledgementId, input.societyId);
    if (acknowledgement.documentKind !== "acknowledgement" || acknowledgement.voidedAtISO) throw new Error("Choose an active acknowledgement for this gift.");
    if (acknowledgement.amountCents !== input.amountCents || acknowledgement.receivedOnISO !== input.receivedOnISO || acknowledgement.donorName !== input.donorName || acknowledgement.isNonCash !== input.isNonCash) throw new Error("The gift amount, date, donor and kind must match the linked acknowledgement.");
    giftRecordId = String(acknowledgement.giftRecordId || acknowledgement._id);
    const linked = await ctx.db.query("donationReceipts").withIndex("by_source_acknowledgement", q => q.eq("sourceAcknowledgementId", input.sourceAcknowledgementId)).take(201);
    if (linked.length > 200) throw new Error("This gift's receipt history needs review before another preparation.");
    if (linked.some(row => !row.voidedAtISO)) throw new Error("This acknowledgement already has an active official receipt or preparation.");
  }
  if (input.replacesReceiptId) {
    const replaced = await getOwned(ctx, "donationReceipts", input.replacesReceiptId, input.societyId);
    if (!replaced.voidedAtISO) throw new Error("Void the earlier receipt before creating its replacement.");
    if (replaced.replacementReceiptId) throw new Error("The earlier receipt already has a replacement.");
    if (replaced.documentKind !== input.documentKind) throw new Error("A replacement must keep the earlier document kind. Link an acknowledgement through the gift action instead.");
    const replacedGift = String(replaced.giftRecordId || replaced.sourceAcknowledgementId || replaced._id);
    if (giftRecordId && giftRecordId !== replacedGift) throw new Error("A replacement cannot change the underlying gift.");
    if (replaced.sourceAcknowledgementId && !input.sourceAcknowledgementId) throw new Error("Keep an acknowledgement from this gift's history linked to its replacement.");
    giftRecordId = replacedGift;
  }
  if (giftRecordId) {
    const related = await ctx.db.query("donationReceipts").withIndex("by_gift_record", q => q.eq("giftRecordId", giftRecordId)).take(201);
    if (related.length > 200) throw new Error("This gift's document history needs review.");
    if (related.some(row => row.documentKind === "official_tax_receipt" && !row.voidedAtISO)) throw new Error("This gift already has an active official receipt or preparation. Void it before preparing another document for the same gift.");
  }
  return giftRecordId;
}

export async function captureReceiptEvidence(ctx: PortableQueryCtx, societyId: string, documentId: string, requireFile = false): Promise<ReceiptEvidenceSnapshot> {
  await requirePermissionPortable(ctx, societyId, "documents:read");
  const document = await getOwned(ctx, "documents", documentId, societyId);
  await requireDocumentAccess(ctx, documentId);
  if (document.flaggedForDeletion || document.archivedAtISO) throw new Error("Choose an active retained evidence document.");
  const versions = await ctx.db.query("documentVersions").withIndex("by_document", q => q.eq("documentId", documentId)).take(201);
  if (versions.length > 200) throw new Error("The evidence version history needs review.");
  if (versions.some(version => version.societyId !== societyId)) throw new Error("documentVersions not found.");
  const current = versions.filter(version => version.isCurrent);
  if (versions.length && current.length !== 1) throw new Error("The evidence document needs exactly one current version.");
  const version = current[0];
  const mimeType = String(version?.mimeType || document.mimeType || "").toLowerCase();
  if (requireFile && !["application/pdf", "image/png", "image/jpeg"].includes(mimeType)) throw new Error("Upload the signed paper receipt as a PDF, PNG or JPEG before recording its issue.");
  if (version) {
    const supported = version.storageProvider === "local-indexeddb" || DOCUMENT_STORAGE_CAPABILITIES.some(provider => provider.provider === version.storageProvider && provider.immutableVersions && provider.checksum);
    if (!supported || !version.storageKey || /^(https?:|data:|demo:)/i.test(version.storageKey)) throw new Error("Evidence needs a retained uploaded file in a supported versioned store; an external or demo file is not sufficient.");
    if (!/^[a-f0-9]{64}$/i.test(version.sha256 || "") || !Number.isSafeInteger(version.fileSizeBytes) || version.fileSizeBytes <= 0) throw new Error("The uploaded evidence needs a verified checksum and byte size.");
    if (version.storageProvider === "sharepoint") {
      let locator: { versionId?: string } | undefined;
      try { locator = JSON.parse(String(version.storageKey).replace(/^sharepoint:/, "")); } catch { /* A missing immutable version is a review requirement. */ }
      if (!locator?.versionId) throw new Error("Pin the SharePoint file version before using it as retained receipt evidence.");
    }
    const descriptor = { documentId, documentVersionId: version._id, provider: version.storageProvider, key: version.storageKey, fileName: String(version.fileName), mimeType, sha256: String(version.sha256).toLowerCase(), fileSizeBytes: Number(version.fileSizeBytes) };
    const { provider: _provider, key: _key, ...snapshot } = descriptor;
    return { ...snapshot, fingerprint: await receiptEvidenceFingerprint(descriptor) };
  }
  if (document.storageId) {
    const descriptor = { documentId, storageId: String(document.storageId), fileName: String(document.fileName || "receipt-evidence.pdf"), mimeType, ...(document.fileSizeBytes ? { fileSizeBytes: Number(document.fileSizeBytes) } : {}) };
    return { ...descriptor, fingerprint: await receiptEvidenceFingerprint(descriptor) };
  }
  if (!requireFile && typeof document.content === "string" && document.content.trim()) {
    if (document.content.length > 65_536) throw new Error("Retain this evidence as an uploaded file before reviewing it.");
    return { documentId, fingerprint: await receiptEvidenceFingerprint({ documentId, content: document.content }) };
  }
  throw new Error("Evidence needs a retained file or source text. An external link or empty document is not sufficient.");
}

export async function receiptEvidenceForReviewPortable(ctx: PortableQueryCtx, { societyId, documentIds, requireFile = false }: { societyId: string; documentIds: string[]; requireFile?: boolean }): Promise<ReceiptEvidenceReview[]> {
  await requirePermissionPortable(ctx, societyId, "society:read");
  if (documentIds.length > 20 || new Set(documentIds).size !== documentIds.length) throw new Error("Choose no more than 20 distinct evidence documents.");
  if (documentIds.length) await requirePermissionPortable(ctx, societyId, "documents:read");
  // Authorization failures reject the request. Per-file review issues apply
  // only to sources this actor can already access in this workspace.
  await Promise.all(documentIds.map(async id => {
    await getOwned(ctx, "documents", id, societyId);
    await requireDocumentAccess(ctx, id);
  }));
  return Promise.all(documentIds.map(async id => {
    try { return await captureReceiptEvidence(ctx, societyId, id, requireFile); }
    catch (error) { return { documentId: id, fingerprint: "", reviewIssue: error instanceof Error ? error.message : "Evidence could not be assessed." }; }
  }));
}

export async function receiptSignedCopySnapshot(ctx: PortableQueryCtx, societyId: string, documentId: string, expectedFingerprint: string) {
  const snapshot = await captureReceiptEvidence(ctx, societyId, documentId, true);
  if (snapshot.fingerprint !== expectedFingerprint) throw new Error("The signed file changed after review. Review the current file before recording its issue.");
  return { ...snapshot, fileName: snapshot.fileName!, mimeType: snapshot.mimeType! };
}
