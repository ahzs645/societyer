import type { PortableDoc, PortableQueryCtx } from "../portable/ctx";
import { CHARITY_REGISTRATION_HISTORY_LIMIT } from "../receipting/registration";

const SIGNED_COPY_REFERENCE_LIMIT = 200;
const RETAINED_EVIDENCE_MESSAGE = "This document is retained as charity-registration or signed-receipt evidence. Archive it instead of deleting it; historical evidence must remain available.";
const IMMUTABLE_EVIDENCE_MESSAGE = "This content or file metadata is retained as charity-registration or signed-receipt evidence. Keep the recorded evidence unchanged and upload a new document or file version for a correction.";

async function retainedRegistrationHistory(ctx: PortableQueryCtx, societyId: string) {
  const revisions = await ctx.db.query("organizationTaxRegistrations")
    .withIndex("by_society", q => q.eq("societyId", societyId))
    .take(CHARITY_REGISTRATION_HISTORY_LIMIT + 1);
  if (revisions.length > CHARITY_REGISTRATION_HISTORY_LIMIT) {
    throw new Error("The charity-registration history exceeds the evidence-review limit. Archive the document instead; review the retained history before changing or deleting its evidence.");
  }
  return revisions;
}

async function registrationReferences(ctx: PortableQueryCtx, document: PortableDoc) {
  return (await retainedRegistrationHistory(ctx, String(document.societyId))).filter(revision => revision.evidenceDocumentIds?.includes(document._id)
    || revision.evidenceSnapshots?.some((snapshot: any) => snapshot.documentId === document._id));
}

/** Original document parents for retained native blobs, even after a later upload changes the current file. */
export async function retainedReceiptEvidenceDocumentIds(ctx: PortableQueryCtx, societyId: string, storageId: string): Promise<string[]> {
  const receipts = await ctx.db.query("donationReceipts")
    .withIndex("by_signed_copy_storage", q => q.eq("signedCopySnapshot.storageId", storageId))
    .take(SIGNED_COPY_REFERENCE_LIMIT + 1);
  if (receipts.length > SIGNED_COPY_REFERENCE_LIMIT) throw new Error("The retained signed-file history exceeds the evidence-review limit.");
  const ids = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.societyId === societyId && receipt.signedCopySnapshot?.documentId === receipt.signedCopyDocumentId) {
      ids.add(String(receipt.signedCopyDocumentId));
    }
  }
  for (const revision of await retainedRegistrationHistory(ctx, societyId)) {
    for (const snapshot of revision.evidenceSnapshots ?? []) {
      if (snapshot.storageId === storageId && revision.evidenceDocumentIds?.includes(snapshot.documentId)) ids.add(String(snapshot.documentId));
    }
  }
  if (ids.size > SIGNED_COPY_REFERENCE_LIMIT) throw new Error("The retained file's document history exceeds the evidence-review limit.");
  return [...ids];
}

/** A branding alias must not delete an attached file, historical proof, or the
 * logo captured by an invoice. Prepared drafts and void invoices also retain
 * their captured document identity. */
export async function storageHasRetainedDocumentReference(ctx: PortableQueryCtx, societyId: string, storageId: string): Promise<boolean> {
  const liveDocument = await ctx.db.query("documents").withIndex("by_storage", q => q.eq("storageId", storageId)).first();
  if (liveDocument) return true;
  const invoice = await ctx.db.query("invoices")
    .withIndex("by_issuer_logo", q => q.eq("issuerSnapshot.logoStorageId", storageId))
    .first();
  if (invoice) return true;
  const previousInvoice = await ctx.db.query("invoiceDocumentRevisions")
    .withIndex("by_issuer_logo", q => q.eq("issuerLogoStorageId", storageId)).first();
  if (previousInvoice) return true;
  return (await retainedReceiptEvidenceDocumentIds(ctx, societyId, storageId)).length > 0;
}

/** A void or a replacement never erases the evidence supporting the earlier receipt. */
export async function assertReceiptEvidenceDocumentMayBeDeleted(ctx: PortableQueryCtx, document: PortableDoc) {
  const signedReceipt = await ctx.db.query("donationReceipts")
    .withIndex("by_signed_copy_document", q => q.eq("signedCopyDocumentId", document._id))
    .first();
  if (signedReceipt || (await registrationReferences(ctx, document)).length) throw new Error(RETAINED_EVIDENCE_MESSAGE);
}

type EvidenceContentPatch = {
  content?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  sha256?: string;
  storageId?: string;
};

/**
 * Only in-place content/file metadata changes are guarded. Titles, tags,
 * categories, archive state and the current-version pointer remain editable.
 * A newly uploaded version does not replace the retained version referenced by
 * a receipt or a reviewed registration revision.
 */
export async function assertReceiptEvidenceContentUnchanged(
  ctx: PortableQueryCtx,
  document: PortableDoc,
  patch: EvidenceContentPatch,
  currentVersion?: PortableDoc,
) {
  const contentChanged = patch.content !== undefined && patch.content !== document.content;
  const linkChanged = patch.url !== undefined && patch.url !== document.url;
  const storedBlobChanged = patch.storageId !== undefined && patch.storageId !== document.storageId;
  const metadataChanged = ["fileName", "mimeType", "fileSizeBytes", "sha256"].some(field =>
    patch[field as keyof EvidenceContentPatch] !== undefined
      && patch[field as keyof EvidenceContentPatch] !== (currentVersion ?? document)[field]);
  if (!contentChanged && !linkChanged && !storedBlobChanged && !metadataChanged) return;

  const signatures = await ctx.db.query("donationReceipts")
    .withIndex("by_signed_copy_document", q => q.eq("signedCopyDocumentId", document._id))
    .take(SIGNED_COPY_REFERENCE_LIMIT + 1);
  if (signatures.length > SIGNED_COPY_REFERENCE_LIMIT) {
    throw new Error("This document's signed-receipt history exceeds the evidence-review limit. Keep its evidence unchanged and upload a new document for a correction.");
  }
  const registrations = await registrationReferences(ctx, document);
  if ((contentChanged || linkChanged || storedBlobChanged) && (signatures.length || registrations.length)) {
    throw new Error(IMMUTABLE_EVIDENCE_MESSAGE);
  }
  if (!metadataChanged) return;
  const versionPinnedBySignature = signatures.some(receipt =>
    !receipt.signedCopySnapshot?.documentVersionId
      || receipt.signedCopySnapshot.documentVersionId === currentVersion?._id);
  const versionPinnedByRegistration = registrations.some(revision => {
    const snapshots = revision.evidenceSnapshots?.filter((snapshot: any) => snapshot.documentId === document._id);
    // Earlier revisions may contain only a document ID. Preserve their metadata
    // conservatively because the original proof was not pinned to a version.
    return !snapshots?.length || snapshots.some((snapshot: any) =>
      !snapshot.documentVersionId || snapshot.documentVersionId === currentVersion?._id);
  });
  if (versionPinnedBySignature || versionPinnedByRegistration) throw new Error(IMMUTABLE_EVIDENCE_MESSAGE);
}
